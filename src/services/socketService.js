const jwt    = require("jsonwebtoken");
const { query } = require("../config/database");
const { setVehicleLocation } = require("../config/redis");
const logger = require("../utils/logger");

module.exports = function socketHandler(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error("Auth required"));
      const { id } = jwt.verify(token, process.env.JWT_SECRET);
      const { rows:[user] } = await query("SELECT id,name,role FROM users WHERE id=$1 AND is_active=TRUE", [id]);
      if (!user) return next(new Error("User not found"));
      socket.user = user;
      next();
    } catch(e) { next(new Error("Invalid token")); }
  });

  io.on("connection", socket => {
    const { id:userId, name, role } = socket.user;
    socket.join(`user:${userId}`);
    logger.debug(`Socket connected: ${name} (${role})`);

    // Commuter: watch vehicle or stop
    socket.on("watch:vehicle", vid => socket.join(`vehicle:${vid}`));
    socket.on("unwatch:vehicle", vid => socket.leave(`vehicle:${vid}`));
    socket.on("watch:stop", sid => socket.join(`stop:${sid}`));

    if (role === "driver") {
      socket.on("driver:online", async ({ vehicleId }) => {
        socket.vehicleId = vehicleId;
        socket.join(`vehicle:${vehicleId}`);
        await query("UPDATE vehicles SET status='loading' WHERE id=$1", [vehicleId]).catch(()=>{});
        io.emit("vehicle:status", { vehicleId, status:"loading" });
        socket.emit("driver:online:ack", { vehicleId });
        logger.info(`Driver ${name} online → vehicle ${vehicleId}`);
      });

      socket.on("driver:location", async ({ lat, lng, heading=0, speed=0 }) => {
        if (!socket.vehicleId) return;
        await setVehicleLocation(socket.vehicleId, lat, lng, heading);
        socket.to(`vehicle:${socket.vehicleId}`).emit("vehicle:location",
          { vehicleId:socket.vehicleId, lat, lng, heading, speed, ts:Date.now() }
        );
      });

      socket.on("driver:passengers", async ({ vehicleId, count, capacity }) => {
        const status = count >= capacity ? "full" : "en_route";
        await query("UPDATE vehicles SET status=$1 WHERE id=$2", [status, vehicleId]).catch(()=>{});
        io.to(`vehicle:${vehicleId}`).emit("vehicle:passengers", { vehicleId, count, capacity, status });
        io.emit("vehicle:status", { vehicleId, status });
      });

      socket.on("driver:approaching", ({ vehicleId, stopId, etaMinutes }) => {
        io.to(`stop:${stopId}`).emit("vehicle:approaching", { vehicleId, stopId, etaMinutes });
      });

      socket.on("driver:offline", async ({ vehicleId }) => {
        await query("UPDATE vehicles SET status='idle' WHERE id=$1", [vehicleId]).catch(()=>{});
        io.emit("vehicle:status", { vehicleId, status:"idle" });
      });
    }

    socket.on("disconnect", async reason => {
      logger.debug(`Socket disconnected: ${name} — ${reason}`);
      if (role==="driver" && socket.vehicleId) {
        setTimeout(async () => {
          const room = io.sockets.adapter.rooms.get(`driver:${userId}`);
          if (!room || room.size===0) {
            await query("UPDATE vehicles SET status='idle' WHERE id=$1", [socket.vehicleId]).catch(()=>{});
            io.emit("vehicle:status", { vehicleId:socket.vehicleId, status:"idle" });
          }
        }, 30000);
      }
    });
  });

  logger.info("✅ Socket.IO handler ready");
};
