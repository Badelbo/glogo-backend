const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");
const { v4: uuid } = require("uuid");

router.get("/me", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { rows:[driver] } = await query(
      `SELECT d.*,u.name,u.phone,u.email,
              v.vehicle_code,v.route_name,v.type AS vehicle_type,v.capacity,v.status AS vehicle_status,v.id AS vehicle_id,v.fare
       FROM drivers d
       JOIN users    u ON u.id=d.user_id
       LEFT JOIN vehicles v ON v.driver_id=d.id AND v.is_active=TRUE
       WHERE d.user_id=$1`,
      [req.user.id]
    );
    if (!driver) return res.status(404).json({ error:"Driver profile not found" });
    const { rows:[stats] } = await query(
      "SELECT COUNT(*) AS trips_today FROM trips WHERE driver_id=$1 AND DATE(created_at)=CURRENT_DATE",
      [driver.id]
    );
    res.json({ driver:{ ...driver, ...stats } });
  } catch(err) { next(err); }
});

router.post("/trips/start", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { vehicleId, fromStopId, toStopId } = req.body;
    const { rows:[d] } = await query("SELECT id FROM drivers WHERE user_id=$1", [req.user.id]);
    if (!d) return res.status(404).json({ error:"Driver not found" });
    const { rows:[trip] } = await query(
      `INSERT INTO trips (id,vehicle_id,driver_id,from_stop_id,to_stop_id,status,started_at)
       VALUES ($1,$2,$3,$4,$5,'active',NOW()) RETURNING *`,
      [uuid(), vehicleId, d.id, fromStopId||null, toStopId||null]
    );
    await query("UPDATE vehicles SET status='en_route' WHERE id=$1", [vehicleId]);
    res.status(201).json({ trip, message:"Trip started! Safe journey 🇬🇭" });
  } catch(err) { next(err); }
});

router.patch("/trips/:tripId/complete", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { passengersCount=0 } = req.body;
    const { rows:[trip] } = await query(
      "SELECT id,vehicle_id,driver_id FROM trips WHERE id=$1 AND status='active'", [req.params.tripId]
    );
    if (!trip) return res.status(404).json({ error:"Active trip not found" });
    await query("UPDATE trips SET status='completed',completed_at=NOW(),passengers_count=$1 WHERE id=$2", [passengersCount, trip.id]);
    await query("UPDATE vehicles SET status='idle' WHERE id=$1", [trip.vehicle_id]);
    await query("UPDATE drivers SET total_trips=total_trips+1 WHERE id=$1", [trip.driver_id]);
    res.json({ message:"Trip completed 🎉" });
  } catch(err) { next(err); }
});

router.get("/trips", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { rows:[d] } = await query("SELECT id FROM drivers WHERE user_id=$1", [req.user.id]);
    const { rows } = await query(
      `SELECT t.*,v.vehicle_code,s1.name AS from_stop,s2.name AS to_stop
       FROM trips t
       JOIN vehicles v ON v.id=t.vehicle_id
       LEFT JOIN stops s1 ON s1.id=t.from_stop_id
       LEFT JOIN stops s2 ON s2.id=t.to_stop_id
       WHERE t.driver_id=$1 ORDER BY t.created_at DESC LIMIT 50`,
      [d.id]
    );
    res.json({ trips: rows });
  } catch(err) { next(err); }
});

module.exports = router;
