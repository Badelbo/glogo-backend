const logger = require("../utils/logger");
const { setVehicleLocation } = require("../config/redis");
const { query } = require("../config/database");
const jwt = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");

// ── Send cancellation notifications to all commuters in a queue ──
async function cancelQueueAndNotify(io, vehicleId, reason) {
  try {
    // Get all waiting queue entries for this vehicle
    const { rows: entries } = await query(
      `SELECT qe.id, qe.user_id, qe.queue_number,
              v.vehicle_code, v.route_name, v.fare
       FROM queue_entries qe
       JOIN vehicles v ON v.id = qe.vehicle_id
       WHERE qe.vehicle_id = $1
         AND qe.status IN ('waiting','ready','boarding')`,
      [vehicleId]
    );

    if (entries.length === 0) return;

    logger.info(`Cancelling ${entries.length} queue entries for vehicle ${vehicleId} — reason: ${reason}`);

    // Cancel all queue entries
    await query(
      `UPDATE queue_entries SET status='cancelled', updated_at=NOW()
       WHERE vehicle_id=$1 AND status IN ('waiting','ready','boarding')`,
      [vehicleId]
    );

    // Notify each commuter
    for (const entry of entries) {
      const notifId = uuidv4();
      const message = reason === "driver_offline"
        ? `Your driver has gone offline. Queue #${entry.queue_number} for ${entry.vehicle_code} (${entry.route_name}) has been cancelled. Please join another vehicle.`
        : `Vehicle ${entry.vehicle_code} is no longer available. Your queue has been cancelled. We apologise for the inconvenience.`;

      // Save notification to DB
      await query(
        `INSERT INTO notifications (id, user_id, type, title, body, sent_at)
         VALUES ($1, $2, 'trip_update', 'Queue Cancelled', $3, NOW())`,
        [notifId, entry.user_id, message]
      ).catch(() => {});

      // Send real-time notification
      io.to(`user:${entry.user_id}`).emit("notification:new", {
        id:       notifId,
        type:     "trip_update",
        title:    "Queue Cancelled",
        body:     message,
        is_read:  false,
        sent_at:  new Date().toISOString(),
      });

      // Also emit queue cancelled event
      io.to(`user:${entry.user_id}`).emit("queue:cancelled", {
        vehicleId,
        queueNumber: entry.queue_number,
        reason,
      });
    }

    // Mark vehicle as idle
    await query(
      "UPDATE vehicles SET status='idle', updated_at=NOW() WHERE id=$1",
      [vehicleId]
    ).catch(() => {});

    // Broadcast vehicle status change to all
    io.emit("vehicle:status", { vehicleId, status:"idle" });

    logger.info(`✅ Cancelled queue and notified ${entries.length} commuters for vehicle ${vehicleId}`);
  } catch(err) {
    logger.error("cancelQueueAndNotify error:", err.message);
  }
}

module.exports = function socketHandler(io) {

  // Track driver heartbeats: { vehicleId -> { userId, lastPing, timer } }
  const driverHeartbeats = new Map();

  // ── Heartbeat checker — runs every 15 seconds ──────────────
  // If a driver misses 3 heartbeats (45 seconds) → auto offline
  const HEARTBEAT_INTERVAL = 15000; // 15 seconds
  const MAX_MISSED         = 3;     // 3 missed = 45 seconds without ping

  setInterval(async () => {
    const now = Date.now();
    for (const [vehicleId, state] of driverHeartbeats.entries()) {
      const secondsSince = (now - state.lastPing) / 1000;
      const missed       = Math.floor(secondsSince / (HEARTBEAT_INTERVAL / 1000));

      if (missed >= MAX_MISSED) {
        logger.warn(`⚠️ Driver ${state.userName} missed ${missed} heartbeats — going offline`);
        driverHeartbeats.delete(vehicleId);

        // Cancel queue and notify all commuters
        await cancelQueueAndNotify(io, vehicleId, "driver_offline");
      }
    }
  }, HEARTBEAT_INTERVAL);

  // ── Auth middleware ────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Authentication required"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const { rows: [user] } = await query(
        "SELECT id, name, role FROM users WHERE id=$1 AND is_active=TRUE",
        [decoded.id]
      );
      if (!user) return next(new Error("User not found"));
      socket.user = user;
      next();
    } catch {
      next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    const { id: userId, name, role } = socket.user;
    logger.info(`Socket connected: ${name} (${role}) — ${socket.id}`);
    socket.join(`user:${userId}`);

    // ── COMMUTER EVENTS ───────────────────────────────────────
    socket.on("watch:vehicle", (vehicleId) => {
      socket.join(`vehicle:${vehicleId}`);
    });
    socket.on("unwatch:vehicle", (vehicleId) => {
      socket.leave(`vehicle:${vehicleId}`);
    });
    socket.on("watch:stop", (stopId)   => { socket.join(`stop:${stopId}`); });
    socket.on("unwatch:stop", (stopId) => { socket.leave(`stop:${stopId}`); });

    // ── DRIVER EVENTS ─────────────────────────────────────────
    if (role === "driver") {

      // Driver goes live
      socket.on("driver:online", async ({ vehicleId }) => {
        socket.vehicleId  = vehicleId;
        socket.join(`vehicle:${vehicleId}`);
        socket.join(`driver:${userId}`);

        await query(
          "UPDATE vehicles SET status='loading', updated_at=NOW() WHERE id=$1",
          [vehicleId]
        ).catch(() => {});

        // Start heartbeat tracking
        driverHeartbeats.set(vehicleId, {
          userId,
          userName:  name,
          lastPing:  Date.now(),
          vehicleId,
        });

        io.emit("vehicle:status", { vehicleId, status:"loading" });
        socket.emit("driver:online:ack", {
          vehicleId,
          message:           "You are now LIVE on Glogo 🇬🇭",
          heartbeatInterval: HEARTBEAT_INTERVAL,
        });

        logger.info(`Driver ${name} online for vehicle ${vehicleId}`);
      });

      // ── HEARTBEAT — driver sends this every 15 seconds ──────
      socket.on("driver:heartbeat", ({ vehicleId }) => {
        const state = driverHeartbeats.get(vehicleId);
        if (state) {
          state.lastPing = Date.now();
          driverHeartbeats.set(vehicleId, state);
        }
        socket.emit("driver:heartbeat:ack", { ts: Date.now() });
      });

      // Driver GPS location
      socket.on("driver:location", async ({ lat, lng, heading=0, speed=0, vehicleId: vId }) => {
        const vid = vId || socket.vehicleId;
        if (!vid) return;

        // Update heartbeat on any activity
        const state = driverHeartbeats.get(vid);
        if (state) { state.lastPing = Date.now(); driverHeartbeats.set(vid, state); }

        await setVehicleLocation(vid, lat, lng, heading).catch(() => {});

        socket.to(`vehicle:${vid}`).emit("vehicle:location", {
          vehicleId: vid, lat, lng, heading, speed, ts: Date.now()
        });

        if (socket.shouldPersist) {
          await query(
            "UPDATE vehicles SET current_lat=$1,current_lng=$2,heading=$3,updated_at=NOW() WHERE id=$4",
            [lat, lng, heading, vid]
          ).catch(() => {});
          socket.shouldPersist = false;
        }
      });

      socket.on("driver:persist", () => { socket.shouldPersist = true; });

      // Driver updates passengers
      socket.on("driver:passengers", async ({ vehicleId, count, capacity }) => {
        const status = count >= capacity ? "full" : "en_route";
        await query(
          "UPDATE vehicles SET status=$1, updated_at=NOW() WHERE id=$2",
          [status, vehicleId]
        ).catch(() => {});
        io.to(`vehicle:${vehicleId}`).emit("vehicle:passengers", { vehicleId, count, capacity, status });
        io.emit("vehicle:status", { vehicleId, status });
      });

      // Driver approaching a stop
      socket.on("driver:approaching", async ({ vehicleId, stopId, etaMinutes }) => {
        io.to(`stop:${stopId}`).emit("vehicle:approaching", {
          vehicleId, stopId, etaMinutes,
          message: `Your trotro arrives in ${etaMinutes} min!`
        });
      });

      // Driver intentionally goes offline
      socket.on("driver:offline", async ({ vehicleId }) => {
        driverHeartbeats.delete(vehicleId);
        await cancelQueueAndNotify(io, vehicleId, "driver_offline");
        logger.info(`Driver ${name} went offline intentionally`);
      });
    }

    // ── ADMIN ─────────────────────────────────────────────────
    if (role === "admin") {
      socket.join("admin:room");

      // Admin can force a vehicle offline
      socket.on("admin:force_offline", async ({ vehicleId }) => {
        driverHeartbeats.delete(vehicleId);
        await cancelQueueAndNotify(io, vehicleId, "admin_action");
        logger.info(`Admin ${name} forced vehicle ${vehicleId} offline`);
      });
    }

    // ── DISCONNECT ────────────────────────────────────────────
    socket.on("disconnect", async (reason) => {
      logger.info(`Socket disconnected: ${name} — ${reason}`);

      if (role === "driver" && socket.vehicleId) {
        // Grace period: wait 45 seconds before going offline
        // This handles brief network drops without disrupting the queue
        const vehicleId = socket.vehicleId;

        setTimeout(async () => {
          // Check if driver reconnected
          const rooms = io.sockets.adapter.rooms;
          const driverRoom = rooms.get(`driver:${userId}`);

          if (!driverRoom || driverRoom.size === 0) {
            // Driver still gone — check heartbeat state
            const state = driverHeartbeats.get(vehicleId);
            if (state) {
              const secondsAgo = (Date.now() - state.lastPing) / 1000;
              if (secondsAgo > 45) {
                logger.warn(`Driver ${name} disconnected and did not reconnect — going offline`);
                driverHeartbeats.delete(vehicleId);
                await cancelQueueAndNotify(io, vehicleId, "driver_offline");
              }
            }
          }
        }, 45000); // 45 second grace period
      }
    });
  });

  // ── Periodic queue ETA broadcast (every 60s) ──────────────
  setInterval(async () => {
    try {
      const { rows } = await query(
        `SELECT DISTINCT vehicle_id FROM queue_entries WHERE status='waiting'`
      );
      for (const row of rows) {
        const { rows: [v] } = await query(
          "SELECT status FROM vehicles WHERE id=$1",
          [row.vehicle_id]
        );
        if (v) {
          io.to(`vehicle:${row.vehicle_id}`).emit("queue:eta_update", {
            vehicleId: row.vehicle_id,
            status:    v.status,
          });
        }
      }
    } catch (_) {}
  }, 60000);

  logger.info("✅ Socket.IO handler with heartbeat protection initialised");
};
