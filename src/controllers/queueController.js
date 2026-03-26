const { query, getClient } = require("../config/database");
const {
  addToQueue, getQueueLength,
  removeFromQueue, cacheGet, cacheSet
} = require("../config/redis");
const { v4: uuidv4 }      = require("uuid");
const notifService        = require("../services/notificationService");
const logger              = require("../utils/logger");

// ─────────────────────────────────────────────────────────
// POST /api/queues/join
// ─────────────────────────────────────────────────────────
async function joinQueue(req, res, next) {
  const client = await getClient();
  try {
    const { vehicleId, stopId } = req.body;
    const userId = req.user.id;

    const { rows: [vehicle] } = await client.query(
      "SELECT id,vehicle_code,capacity,status,fare,route_name FROM vehicles WHERE id=$1 AND is_active=TRUE",
      [vehicleId]
    );
    if (!vehicle)                    return res.status(404).json({ error: "Vehicle not found" });
    if (vehicle.status === "full")   return res.status(409).json({ error: "Vehicle is full. Try the next one." });
    if (vehicle.status === "offline")return res.status(409).json({ error: "Vehicle is offline." });

    const existing = await client.query(
      `SELECT id FROM queue_entries WHERE user_id=$1 AND vehicle_id=$2
       AND status IN ('waiting','ready','boarding')`,
      [userId, vehicleId]
    );
    if (existing.rows[0]) return res.status(409).json({ error: "You are already in this queue" });

    const countResult = await client.query(
      "SELECT COALESCE(MAX(queue_number),0)+1 AS next FROM queue_entries WHERE vehicle_id=$1",
      [vehicleId]
    );
    const queueNumber = countResult.rows[0].next;
    const queueLen    = await getQueueLength(stopId, vehicleId);

    if (queueLen >= parseInt(process.env.MAX_QUEUE_SIZE || 200)) {
      return res.status(409).json({ error: "Queue is full for this vehicle" });
    }

    const estimatedWait = queueLen * 2;
    await client.query("BEGIN");

    const entryId = uuidv4();
    await client.query(
      `INSERT INTO queue_entries
         (id,user_id,vehicle_id,stop_id,queue_number,status,estimated_wait,payment_status)
       VALUES ($1,$2,$3,$4,$5,'waiting',$6,'pending')`,
      [entryId, userId, vehicleId, stopId, queueNumber, estimatedWait]
    );
    await addToQueue(stopId, vehicleId, userId);
    await client.query("COMMIT");

    const io = req.app.get("io");
    io.to(`vehicle:${vehicleId}`).emit("queue:updated", { vehicleId, stopId, queueLength: queueLen + 1 });
    io.to(`user:${userId}`).emit("queue:joined", { entryId, queueNumber, estimatedWait, vehicle });

    await notifService.sendToUser(userId, {
      type:  "queue_ready",
      title: "Queue Joined! ✅",
      body:  `You are #${queueNumber} for ${vehicle.route_name}. Your fare of GHS ${parseFloat(vehicle.fare).toFixed(2)} will be collected when you board.`,
      data:  { vehicleId, entryId, queueNumber: String(queueNumber) }
    });

    logger.info(`User ${userId} joined queue #${queueNumber} for ${vehicle.vehicle_code}`);
    res.status(201).json({
      message: "Queue joined! Your fare will be collected when you board.",
      entry:   { id: entryId, queueNumber, estimatedWait, vehicleId, stopId },
      vehicle: { code: vehicle.vehicle_code, route: vehicle.route_name, fare: vehicle.fare }
    });
  } catch(err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client.release(); }
}

// ─────────────────────────────────────────────────────────
// DELETE /api/queues/:entryId/leave
// ─────────────────────────────────────────────────────────
async function leaveQueue(req, res, next) {
  const client = await getClient();
  try {
    const { entryId } = req.params;
    const userId = req.user.id;

    const { rows: [entry] } = await client.query(
      "SELECT id,user_id,vehicle_id,stop_id,status,payment_status FROM queue_entries WHERE id=$1",
      [entryId]
    );
    if (!entry)                   return res.status(404).json({ error: "Queue entry not found" });
    if (entry.user_id !== userId) return res.status(403).json({ error: "Not your queue entry" });
    if (!["waiting","ready"].includes(entry.status)) {
      return res.status(400).json({ error: "Cannot leave — already boarding or boarded" });
    }

    // If payment was already taken — refund needed
    if (entry.payment_status === "paid") {
      logger.warn(`User ${userId} leaving after payment — refund needed for entry ${entryId}`);
      // TODO: trigger refund via MoMo API when production is live
    }

    await client.query("BEGIN");
    await client.query(
      "UPDATE queue_entries SET status='cancelled', cancelled_at=NOW() WHERE id=$1",
      [entryId]
    );
    await removeFromQueue(entry.stop_id, entry.vehicle_id, userId);
    await client.query("COMMIT");

    const io = req.app.get("io");
    io.to(`vehicle:${entry.vehicle_id}`).emit("queue:updated", { vehicleId: entry.vehicle_id });

    res.json({ message: "Left queue successfully" });
  } catch(err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client.release(); }
}

// ─────────────────────────────────────────────────────────
// GET /api/queues/my
// ─────────────────────────────────────────────────────────
async function myQueues(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT qe.id, qe.queue_number, qe.status, qe.estimated_wait,
              qe.joined_at, qe.payment_status,
              v.vehicle_code, v.route_name, v.fare, v.type AS vehicle_type,
              s.name AS stop_name
       FROM queue_entries qe
       JOIN vehicles v ON v.id = qe.vehicle_id
       JOIN stops    s ON s.id = qe.stop_id
       WHERE qe.user_id=$1 AND qe.status IN ('waiting','ready','boarding')
       ORDER BY qe.joined_at DESC`,
      [req.user.id]
    );
    res.json({ queues: rows });
  } catch(err) { next(err); }
}

// ─────────────────────────────────────────────────────────
// GET /api/queues/:vehicleId/:stopId
// ─────────────────────────────────────────────────────────
async function getVehicleQueue(req, res, next) {
  try {
    const { vehicleId, stopId } = req.params;
    const cacheKey = `queue:list:${vehicleId}:${stopId}`;
    const cached   = await cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const { rows } = await query(
      `SELECT qe.id, qe.queue_number, qe.status,
              qe.estimated_wait, qe.payment_status,
              u.name AS commuter_name, u.phone AS commuter_phone
       FROM queue_entries qe
       JOIN users u ON u.id = qe.user_id
       WHERE qe.vehicle_id=$1 AND qe.stop_id=$2
         AND qe.status IN ('waiting','ready','boarding')
       ORDER BY qe.queue_number ASC`,
      [vehicleId, stopId]
    );

    const result = { queue: rows, total: rows.length };
    await cacheSet(cacheKey, result, 10);
    res.json(result);
  } catch(err) { next(err); }
}

// ─────────────────────────────────────────────────────────
// PATCH /api/queues/:entryId/board
// Driver confirms a passenger has physically boarded.
// This triggers automatic payment collection.
// ─────────────────────────────────────────────────────────
async function markBoarded(req, res, next) {
  const client = await getClient();
  try {
    const { entryId } = req.params;

    const { rows: [entry] } = await client.query(
      `SELECT qe.id, qe.user_id, qe.vehicle_id, qe.queue_number,
              qe.stop_id, qe.payment_status,
              v.fare, v.route_name, v.vehicle_code, v.driver_id,
              u.name AS commuter_name, u.phone AS commuter_phone
       FROM queue_entries qe
       JOIN vehicles v ON v.id = qe.vehicle_id
       JOIN users    u ON u.id = qe.user_id
       WHERE qe.id=$1`,
      [entryId]
    );
    if (!entry) return res.status(404).json({ error: "Queue entry not found" });

    // Already boarded
    if (entry.status === "boarded") {
      return res.status(409).json({ error: "Passenger already marked as boarded" });
    }

    await client.query("BEGIN");

    // Mark as boarding
    await client.query(
      "UPDATE queue_entries SET status='boarded', boarded_at=NOW() WHERE id=$1",
      [entryId]
    );

    // ── TRIGGER PAYMENT ON BOARDING ──────────────────────────
    // Only collect payment if not already paid
    if (entry.payment_status !== "paid") {
      const paymentId = uuidv4();
      const amount    = parseFloat(entry.fare);

      // Create payment record — sandbox auto-success
      await client.query(
        `INSERT INTO payments
           (id,user_id,queue_entry_id,amount,currency,method,status,
            phone_number,description,provider_ref)
         VALUES ($1,$2,$3,$4,'GHS','auto_boarding','success',$5,$6,$7)`,
        [
          paymentId,
          entry.user_id,
          entryId,
          amount,
          entry.commuter_phone,
          `Fare for ${entry.vehicle_code} — ${entry.route_name}`,
          `BOARDING-${entryId.slice(0,8).toUpperCase()}`,
        ]
      );

      // Mark queue entry as paid
      await client.query(
        "UPDATE queue_entries SET payment_status='paid' WHERE id=$1",
        [entryId]
      );

      logger.info(`Payment collected on boarding: GHS ${amount} from ${entry.commuter_name} for ${entry.vehicle_code}`);
    }

    await client.query("COMMIT");

    // Notify commuter
    await notifService.sendToUser(entry.user_id, {
      type:  "payment_success",
      title: "Boarded & Paid ✅",
      body:  `GHS ${parseFloat(entry.fare).toFixed(2)} collected for ${entry.route_name}. Safe journey!`,
      data:  { entryId }
    });

    const io = req.app.get("io");
    io.to(`user:${entry.user_id}`).emit("queue:boarded",       { entryId, vehicleId: entry.vehicle_id });
    io.to(`user:${entry.user_id}`).emit("payment:success",     { entryId, amount: entry.fare });
    io.to(`vehicle:${entry.vehicle_id}`).emit("queue:updated", { vehicleId: entry.vehicle_id });

    res.json({
      message: `${entry.commuter_name} confirmed boarding. GHS ${parseFloat(entry.fare).toFixed(2)} collected.`,
      entry:   { id: entryId, commuter: entry.commuter_name, fare: entry.fare }
    });
  } catch(err) {
    await client.query("ROLLBACK").catch(() => {});
    next(err);
  } finally { client.release(); }
}

// ─────────────────────────────────────────────────────────
// GET /api/queues/vehicle/:vehicleId — driver sees their queue
// ─────────────────────────────────────────────────────────
async function getDriverQueue(req, res, next) {
  try {
    const { vehicleId } = req.params;
    const { rows } = await query(
      `SELECT qe.id, qe.queue_number, qe.status, qe.payment_status,
              u.name AS commuter_name, u.phone AS commuter_phone
       FROM queue_entries qe
       JOIN users u ON u.id = qe.user_id
       WHERE qe.vehicle_id=$1 AND qe.status IN ('waiting','ready','boarding')
       ORDER BY qe.queue_number ASC`,
      [vehicleId]
    );
    res.json({ queue: rows, total: rows.length });
  } catch(err) { next(err); }
}

module.exports = { joinQueue, leaveQueue, myQueues, getVehicleQueue, markBoarded, getDriverQueue };
