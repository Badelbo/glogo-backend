const { query }  = require("../config/database");
const { setVehicleLocation, getVehicleLocation, cacheGet, cacheSet } = require("../config/redis");
const logger = require("../utils/logger");

async function getAllVehicles(req, res, next) {
  try {
    const cached = await cacheGet("vehicles:all");
    if (cached) return res.json(cached);

    const { rows } = await query(`
      SELECT v.id,v.vehicle_code,v.type,v.capacity,v.status,v.route_name,v.fare,
             v.current_lat,v.current_lng,v.heading,
             u.name AS driver_name, u.phone AS driver_phone,
             s.name AS current_stop_name,
             (SELECT COUNT(*) FROM queue_entries qe WHERE qe.vehicle_id=v.id AND qe.status IN ('waiting','ready','boarding')) AS queue_count,
             (SELECT COUNT(*) FROM queue_entries qe WHERE qe.vehicle_id=v.id AND qe.status='boarded') AS on_board_count
      FROM vehicles v
      LEFT JOIN drivers d ON d.id=v.driver_id
      LEFT JOIN users   u ON u.id=d.user_id
      LEFT JOIN stops   s ON s.id=v.current_stop_id
      WHERE v.is_active=TRUE ORDER BY v.vehicle_code
    `);

    const vehicles = await Promise.all(rows.map(async v => {
      const live = await getVehicleLocation(v.id);
      return { ...v, live_location: live,
        passengers: parseInt(v.on_board_count) || 0,
        seats_free: v.capacity - (parseInt(v.on_board_count)||0) };
    }));

    const result = { vehicles, total: vehicles.length };
    await cacheSet("vehicles:all", result, 8);
    res.json(result);
  } catch(err) { next(err); }
}

async function getVehicle(req, res, next) {
  try {
    const { rows:[v] } = await query(`
      SELECT v.*,u.name AS driver_name,s.name AS current_stop
      FROM vehicles v
      LEFT JOIN drivers d ON d.id=v.driver_id
      LEFT JOIN users   u ON u.id=d.user_id
      LEFT JOIN stops   s ON s.id=v.current_stop_id
      WHERE v.id=$1`, [req.params.id]
    );
    if (!v) return res.status(404).json({ error: "Vehicle not found" });
    const live = await getVehicleLocation(req.params.id);
    res.json({ vehicle: { ...v, live_location: live } });
  } catch(err) { next(err); }
}

async function updateLocation(req, res, next) {
  try {
    const { id } = req.params;
    const { lat, lng, heading=0, speed=0, persist=false } = req.body;
    await setVehicleLocation(id, lat, lng, heading);
    if (persist) {
      await query("UPDATE vehicles SET current_lat=$1,current_lng=$2,heading=$3 WHERE id=$4", [lat,lng,heading,id]);
    }
    req.app.get("io")?.to(`vehicle:${id}`).emit("vehicle:location", { vehicleId:id, lat, lng, heading, speed });
    res.json({ ok: true });
  } catch(err) { next(err); }
}

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ["idle","loading","en_route","full","offline"];
    if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
    await query("UPDATE vehicles SET status=$1 WHERE id=$2", [status, id]);
    await cacheSet("vehicles:all", null, 0);
    const io = req.app.get("io");
    io?.to(`vehicle:${id}`).emit("vehicle:status", { vehicleId:id, status });
    io?.emit("vehicles:refresh");
    res.json({ message:`Status → ${status}` });
  } catch(err) { next(err); }
}

module.exports = { getAllVehicles, getVehicle, updateLocation, updateStatus };
