const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");
const { v4: uuidv4 } = require("uuid");

// GET /api/drivers/me — driver profile + today's stats
router.get("/me", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { rows: [driver] } = await query(
      `SELECT d.*, u.name, u.phone, u.email,
              v.vehicle_code, v.route_name, v.type AS vehicle_type, v.capacity, v.status AS vehicle_status, v.id AS vehicle_id
       FROM drivers d
       JOIN users    u ON u.id = d.user_id
       LEFT JOIN vehicles v ON v.driver_id = d.id AND v.is_active = TRUE
       WHERE d.user_id = $1`,
      [req.user.id]
    );
    if (!driver) return res.status(404).json({ error: "Driver profile not found" });

    // Today's trip count
    const { rows: [stats] } = await query(
      `SELECT COUNT(*) AS trips_today,
              COALESCE(SUM(passengers_count),0) AS passengers_today
       FROM trips WHERE driver_id=$1 AND DATE(created_at)=CURRENT_DATE`,
      [driver.id]
    );

    res.json({ driver: { ...driver, ...stats } });
  } catch (err) { next(err); }
});

// POST /api/drivers/trips/start — start a new trip
router.post("/trips/start", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { vehicleId, fromStopId, toStopId } = req.body;

    const { rows: [driver] } = await query(
      "SELECT id FROM drivers WHERE user_id=$1", [req.user.id]
    );
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const tripId = uuidv4();
    const { rows: [trip] } = await query(
      `INSERT INTO trips (id,vehicle_id,driver_id,from_stop_id,to_stop_id,status,started_at)
       VALUES ($1,$2,$3,$4,$5,'active',NOW()) RETURNING *`,
      [tripId, vehicleId, driver.id, fromStopId || null, toStopId || null]
    );

    await query("UPDATE vehicles SET status='en_route', updated_at=NOW() WHERE id=$1", [vehicleId]);

    res.status(201).json({ trip, message: "Trip started — safe journey! 🇬🇭" });
  } catch (err) { next(err); }
});

// PATCH /api/drivers/trips/:tripId/complete
router.patch("/trips/:tripId/complete", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { passengersCount = 0 } = req.body;

    const { rows: [trip] } = await query(
      "SELECT id, vehicle_id, driver_id FROM trips WHERE id=$1 AND status='active'",
      [req.params.tripId]
    );
    if (!trip) return res.status(404).json({ error: "Active trip not found" });

    await query(
      "UPDATE trips SET status='completed', completed_at=NOW(), passengers_count=$1 WHERE id=$2",
      [passengersCount, trip.id]
    );
    await query(
      "UPDATE vehicles SET status='idle', updated_at=NOW() WHERE id=$1", [trip.vehicle_id]
    );
    await query(
      "UPDATE drivers SET total_trips=total_trips+1 WHERE id=$1", [trip.driver_id]
    );

    res.json({ message: "Trip completed. Well done! 🎉" });
  } catch (err) { next(err); }
});

// GET /api/drivers/trips — trip history
router.get("/trips", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { rows: [driver] } = await query(
      "SELECT id FROM drivers WHERE user_id=$1", [req.user.id]
    );
    const { rows } = await query(
      `SELECT t.*, v.vehicle_code, s1.name AS from_stop, s2.name AS to_stop
       FROM trips t
       JOIN vehicles v ON v.id = t.vehicle_id
       LEFT JOIN stops s1 ON s1.id = t.from_stop_id
       LEFT JOIN stops s2 ON s2.id = t.to_stop_id
       WHERE t.driver_id=$1 ORDER BY t.created_at DESC LIMIT 50`,
      [driver.id]
    );
    res.json({ trips: rows });
  } catch (err) { next(err); }
});

module.exports = router;

// GET /api/drivers/earnings — earnings breakdown by period
router.get("/earnings", authenticate, authorize("driver"), async (req, res, next) => {
  try {
    const { period = "week" } = req.query;

    const { rows: [driver] } = await query(
      "SELECT id FROM drivers WHERE user_id=$1", [req.user.id]
    );
    if (!driver) return res.status(404).json({ error: "Driver not found" });

    const periodFilter = {
      today: "DATE(t.created_at) = CURRENT_DATE",
      week:  "t.created_at >= NOW() - INTERVAL '7 days'",
      month: "t.created_at >= NOW() - INTERVAL '30 days'",
      all:   "1=1",
    }[period] || "t.created_at >= NOW() - INTERVAL '7 days'";

    // Get trips with fares for this period
    const { rows: trips } = await query(
      `SELECT t.*, v.fare FROM trips t
       JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.driver_id=$1 AND t.status='completed' AND ${periodFilter}`,
      [driver.id]
    );

    const calcRevenue = arr => arr.reduce((sum, t) =>
      sum + parseFloat(t.fare||0) * parseInt(t.passengers_count||1), 0
    );

    // Also get all-time and other periods for comparison
    const [todayR, weekR, monthR, allR] = await Promise.all([
      query(`SELECT t.*, v.fare FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.driver_id=$1 AND t.status='completed' AND DATE(t.created_at)=CURRENT_DATE`, [driver.id]),
      query(`SELECT t.*, v.fare FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.driver_id=$1 AND t.status='completed' AND t.created_at >= NOW()-INTERVAL '7 days'`, [driver.id]),
      query(`SELECT t.*, v.fare FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.driver_id=$1 AND t.status='completed' AND t.created_at >= NOW()-INTERVAL '30 days'`, [driver.id]),
      query(`SELECT t.*, v.fare FROM trips t JOIN vehicles v ON v.id=t.vehicle_id WHERE t.driver_id=$1 AND t.status='completed'`, [driver.id]),
    ]);

    res.json({
      period,
      commission_rate: 10,
      today: { trips: todayR.rows.length, revenue: calcRevenue(todayR.rows) },
      week:  { trips: weekR.rows.length,  revenue: calcRevenue(weekR.rows)  },
      month: { trips: monthR.rows.length, revenue: calcRevenue(monthR.rows) },
      all:   { trips: allR.rows.length,   revenue: calcRevenue(allR.rows)   },
      [period]: { trips: trips.length,    revenue: calcRevenue(trips)       },
    });
  } catch(err) { next(err); }
});
