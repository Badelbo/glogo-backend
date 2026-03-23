const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");
const notifService = require("../services/notificationService");

const adminOnly = [authenticate, authorize("admin")];

// GET /api/admin/dashboard — platform overview
router.get("/dashboard", ...adminOnly, async (req, res, next) => {
  try {
    const [users, vehicles, queues, payments, trips] = await Promise.all([
      query("SELECT COUNT(*) FROM users"),
      query("SELECT COUNT(*), status FROM vehicles WHERE is_active=TRUE GROUP BY status"),
      query("SELECT COUNT(*) FROM queue_entries WHERE status IN ('waiting','ready','boarding')"),
      query(`SELECT COUNT(*), status FROM payments WHERE DATE(created_at)=CURRENT_DATE GROUP BY status`),
      query(`SELECT COUNT(*), SUM(passengers_count) AS total_passengers FROM trips WHERE DATE(created_at)=CURRENT_DATE`),
    ]);

    const revenue = await query(
      "SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='success' AND DATE(created_at)=CURRENT_DATE"
    );

    res.json({
      stats: {
        total_users:       parseInt(users.rows[0].count),
        active_queues:     parseInt(queues.rows[0].count),
        vehicles_by_status: vehicles.rows,
        today_trips:       parseInt(trips.rows[0].count || 0),
        today_passengers:  parseInt(trips.rows[0].total_passengers || 0),
        today_payments:    payments.rows,
        today_revenue:     `GHS ${parseFloat(revenue.rows[0].total).toFixed(2)}`,
      }
    });
  } catch (err) { next(err); }
});

// GET /api/admin/users — list all users with filters
router.get("/users", ...adminOnly, async (req, res, next) => {
  try {
    const { role, page = 1, limit = 50, search } = req.query;
    const offset = (page - 1) * limit;
    let sql = `SELECT id,phone,name,email,role,is_active,is_verified,created_at FROM users WHERE 1=1`;
    const params = [];
    if (role) { params.push(role); sql += ` AND role=$${params.length}`; }
    if (search) { params.push(`%${search}%`); sql += ` AND (name ILIKE $${params.length} OR phone ILIKE $${params.length})`; }
    params.push(limit, offset);
    sql += ` ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`;
    const { rows } = await query(sql, params);
    res.json({ users: rows });
  } catch (err) { next(err); }
});

// PATCH /api/admin/users/:id/toggle — activate / deactivate user
router.patch("/users/:id/toggle", ...adminOnly, async (req, res, next) => {
  try {
    const { rows: [u] } = await query(
      "UPDATE users SET is_active = NOT is_active WHERE id=$1 RETURNING id, name, is_active",
      [req.params.id]
    );
    if (!u) return res.status(404).json({ error: "User not found" });
    res.json({ message: `User ${u.name} ${u.is_active ? "activated" : "deactivated"}`, user: u });
  } catch (err) { next(err); }
});

// POST /api/admin/vehicles — create new vehicle
router.post("/vehicles", ...adminOnly, async (req, res, next) => {
  try {
    const { vehicleCode, type, plateNumber, capacity, driverId, routeName, fare } = req.body;
    const { rows: [v] } = await query(
      `INSERT INTO vehicles (id,vehicle_code,type,plate_number,capacity,driver_id,route_name,fare)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [vehicleCode, type, plateNumber, capacity, driverId || null, routeName, fare]
    );
    res.status(201).json({ vehicle: v });
  } catch (err) { next(err); }
});

// POST /api/admin/broadcast — send notification to all users
router.post("/broadcast", ...adminOnly, async (req, res, next) => {
  try {
    const { title, body, role } = req.body;
    let sql = "SELECT id FROM users WHERE is_active=TRUE";
    const params = [];
    if (role) { params.push(role); sql += ` AND role=$1`; }
    const { rows } = await query(sql, params);
    const userIds = rows.map(r => r.id);
    await notifService.sendToMultiple(userIds, { type: "system", title, body });
    res.json({ message: `Broadcast sent to ${userIds.length} users` });
  } catch (err) { next(err); }
});

// GET /api/admin/payments — all payments with filters
router.get("/payments", ...adminOnly, async (req, res, next) => {
  try {
    const { status, method, page = 1 } = req.query;
    const offset = (page - 1) * 50;
    let sql = `SELECT p.*,u.name AS user_name,u.phone FROM payments p JOIN users u ON u.id=p.user_id WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); sql += ` AND p.status=$${params.length}`; }
    if (method) { params.push(method); sql += ` AND p.method=$${params.length}`; }
    params.push(50, offset);
    sql += ` ORDER BY p.created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const { rows } = await query(sql, params);
    res.json({ payments: rows });
  } catch (err) { next(err); }
});

module.exports = router;

// GET /api/admin/users — all users list
router.get("/users", ...adminOnly, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT id, phone, name, email, role, is_active, created_at
       FROM users ORDER BY created_at DESC LIMIT 200`
    );
    res.json({ users: rows });
  } catch(err) { next(err); }
});

// PATCH /api/admin/users/:id — activate or suspend user
router.patch("/users/:id", ...adminOnly, async (req, res, next) => {
  try {
    const { is_active } = req.body;
    await query(
      "UPDATE users SET is_active=$1, updated_at=NOW() WHERE id=$2",
      [is_active, req.params.id]
    );
    res.json({ message: `User ${is_active ? "activated" : "suspended"}` });
  } catch(err) { next(err); }
});

// POST /api/admin/sms — send SMS to a phone number
router.post("/sms", ...adminOnly, async (req, res, next) => {
  try {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: "Phone and message are required" });
    }

    // Log the SMS attempt (real SMS needs Twilio or Africa's Talking credentials)
    const logger = require("../utils/logger");
    logger.info(`SMS to ${phone}: ${message}`);

    // Store as notification in DB so it shows in app
    const { v4: uuidv4 } = require("uuid");
    const { rows: [user] } = await query(
      "SELECT id FROM users WHERE phone=$1", [phone]
    );
    if (user) {
      await query(
        `INSERT INTO notifications (id,user_id,type,title,body,sent_at)
         VALUES ($1,$2,'system','Message from Glogo',$3,NOW())`,
        [uuidv4(), user.id, message]
      );
    }

    res.json({
      message: "SMS logged successfully. Connect Africa's Talking or Twilio for real SMS delivery.",
      phone,
      body: message,
    });
  } catch(err) { next(err); }
});

// GET /api/drivers/earnings — driver earnings by period
// (Added here since it needs auth — imported in drivers route separately)
