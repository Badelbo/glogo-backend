const { query, getClient } = require("../config/database");
const { addToQueue, getQueueLength, removeFromQueue, cacheGet, cacheSet, cacheDel } = require("../config/redis");
const { v4: uuid } = require("uuid");
const notifSvc    = require("../services/notificationService");
const logger       = require("../utils/logger");

async function joinQueue(req, res, next) {
  const client = await getClient();
  try {
    const { vehicleId, stopId } = req.body;
    const userId = req.user.id;
    if (!vehicleId || !stopId) return res.status(400).json({ error: "vehicleId and stopId required" });

    const { rows:[v] } = await client.query(
      "SELECT id,vehicle_code,capacity,status,fare,route_name FROM vehicles WHERE id=$1 AND is_active=TRUE", [vehicleId]
    );
    if (!v)                  return res.status(404).json({ error: "Vehicle not found" });
    if (v.status === "full") return res.status(409).json({ error: "Vehicle is full" });
    if (v.status === "offline") return res.status(409).json({ error: "Vehicle is offline" });

    const dup = await client.query(
      "SELECT id FROM queue_entries WHERE user_id=$1 AND vehicle_id=$2 AND status IN ('waiting','ready','boarding')",
      [userId, vehicleId]
    );
    if (dup.rows[0]) return res.status(409).json({ error: "Already in this queue" });

    const { rows:[{next}] } = await client.query(
      "SELECT COALESCE(MAX(queue_number),0)+1 AS next FROM queue_entries WHERE vehicle_id=$1", [vehicleId]
    );
    const queueLen     = await getQueueLength(stopId, vehicleId);
    const estimatedWait = queueLen * 2;
    const entryId      = uuid();

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO queue_entries (id,user_id,vehicle_id,stop_id,queue_number,status,estimated_wait)
       VALUES ($1,$2,$3,$4,$5,'waiting',$6)`,
      [entryId, userId, vehicleId, stopId, next, estimatedWait]
    );
    await addToQueue(stopId, vehicleId, userId);
    await client.query("COMMIT");

    await cacheDel(`queue:list:${vehicleId}:${stopId}`);

    const io = req.app.get("io");
    io?.to(`vehicle:${vehicleId}`).emit("queue:updated", { vehicleId, stopId, queueLength: queueLen+1 });
    io?.to(`user:${userId}`).emit("queue:joined", { entryId, queueNumber: next, estimatedWait });

    await notifSvc.sendToUser(userId, {
      type:"queue_ready", title:"Joined Queue ✅",
      body:`You are #${next} for ${v.route_name}. Est. wait: ${estimatedWait} min.`,
      data:{ vehicleId, entryId }
    });

    logger.info(`Queue join: user ${userId} → vehicle ${v.vehicle_code} #${next}`);
    res.status(201).json({
      message:"Queue joined!",
      entry:{ id:entryId, queueNumber:next, estimatedWait, vehicleId, stopId },
      vehicle:{ code:v.vehicle_code, route:v.route_name, fare:v.fare }
    });
  } catch(err) {
    await client.query("ROLLBACK").catch(()=>{});
    next(err);
  } finally { client.release(); }
}

async function leaveQueue(req, res, next) {
  const client = await getClient();
  try {
    const { entryId } = req.params;
    const { rows:[entry] } = await client.query(
      "SELECT id,user_id,vehicle_id,stop_id,status FROM queue_entries WHERE id=$1", [entryId]
    );
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    if (entry.user_id !== req.user.id) return res.status(403).json({ error: "Not your entry" });
    if (!["waiting","ready"].includes(entry.status))
      return res.status(400).json({ error: "Cannot leave at this stage" });

    await client.query("BEGIN");
    await client.query("UPDATE queue_entries SET status='cancelled',cancelled_at=NOW() WHERE id=$1", [entryId]);
    await removeFromQueue(entry.stop_id, entry.vehicle_id, req.user.id);
    await client.query("COMMIT");
    await cacheDel(`queue:list:${entry.vehicle_id}:${entry.stop_id}`);

    req.app.get("io")?.to(`vehicle:${entry.vehicle_id}`).emit("queue:updated", { vehicleId: entry.vehicle_id });
    res.json({ message:"Left queue" });
  } catch(err) {
    await client.query("ROLLBACK").catch(()=>{});
    next(err);
  } finally { client.release(); }
}

async function myQueues(req, res, next) {
  try {
    const { rows } = await query(
      `SELECT qe.id,qe.queue_number,qe.status,qe.estimated_wait,qe.joined_at,
              v.vehicle_code,v.route_name,v.fare,v.type AS vehicle_type,
              s.name AS stop_name
       FROM queue_entries qe
       JOIN vehicles v ON v.id=qe.vehicle_id
       JOIN stops    s ON s.id=qe.stop_id
       WHERE qe.user_id=$1 AND qe.status IN ('waiting','ready','boarding')
       ORDER BY qe.joined_at DESC`,
      [req.user.id]
    );
    res.json({ queues: rows });
  } catch(err) { next(err); }
}

async function getVehicleQueue(req, res, next) {
  try {
    const { vehicleId, stopId } = req.params;
    const cKey = `queue:list:${vehicleId}:${stopId}`;
    const cached = await cacheGet(cKey);
    if (cached) return res.json(cached);

    const { rows } = await query(
      `SELECT qe.queue_number,qe.status,qe.estimated_wait,u.name AS commuter_name
       FROM queue_entries qe JOIN users u ON u.id=qe.user_id
       WHERE qe.vehicle_id=$1 AND qe.stop_id=$2 AND qe.status IN ('waiting','ready','boarding')
       ORDER BY qe.queue_number ASC`,
      [vehicleId, stopId]
    );
    const result = { queue: rows, total: rows.length };
    await cacheSet(cKey, result, 10);
    res.json(result);
  } catch(err) { next(err); }
}

async function markBoarded(req, res, next) {
  try {
    const { entryId } = req.params;
    const { rows:[entry] } = await query(
      "SELECT id,user_id,vehicle_id FROM queue_entries WHERE id=$1", [entryId]
    );
    if (!entry) return res.status(404).json({ error: "Entry not found" });
    await query("UPDATE queue_entries SET status='boarded',boarded_at=NOW() WHERE id=$1", [entryId]);
    await notifSvc.sendToUser(entry.user_id, {
      type:"trip_update", title:"On Board! 🚌", body:"Boarding confirmed. Safe journey!"
    });
    req.app.get("io")?.to(`user:${entry.user_id}`).emit("queue:boarded", { entryId });
    res.json({ message:"Boarded" });
  } catch(err) { next(err); }
}

module.exports = { joinQueue, leaveQueue, myQueues, getVehicleQueue, markBoarded };
