const express = require("express");
const router  = express.Router();
const { authenticate, authorize } = require("../middleware/auth");
const { query } = require("../config/database");
const notifSvc = require("../services/notificationService");

const admin = [authenticate, authorize("admin")];

router.get("/dashboard", ...admin, async (req, res, next) => {
  try {
    const [users, vehicles, queues, revenue, trips] = await Promise.all([
      query("SELECT COUNT(*) FROM users"),
      query("SELECT status,COUNT(*) FROM vehicles WHERE is_active=TRUE GROUP BY status"),
      query("SELECT COUNT(*) FROM queue_entries WHERE status IN ('waiting','ready','boarding')"),
      query("SELECT COALESCE(SUM(amount),0) AS total FROM payments WHERE status='success' AND DATE(created_at)=CURRENT_DATE"),
      query("SELECT COUNT(*) FROM trips WHERE DATE(created_at)=CURRENT_DATE"),
    ]);
    res.json({ stats:{
      total_users:     parseInt(users.rows[0].count),
      active_queues:   parseInt(queues.rows[0].count),
      vehicles_status: vehicles.rows,
      today_revenue:   `GHS ${parseFloat(revenue.rows[0].total).toFixed(2)}`,
      today_trips:     parseInt(trips.rows[0].count),
    }});
  } catch(err) { next(err); }
});

router.get("/users", ...admin, async (req, res, next) => {
  try {
    const { role, search, page=1 } = req.query;
    let sql = "SELECT id,phone,name,email,role,is_active,is_verified,created_at FROM users WHERE 1=1";
    const p = [];
    if (role)   { p.push(role);         sql+=` AND role=$${p.length}`; }
    if (search) { p.push(`%${search}%`);sql+=` AND (name ILIKE $${p.length} OR phone ILIKE $${p.length})`; }
    p.push(50, (page-1)*50);
    sql+=` ORDER BY created_at DESC LIMIT $${p.length-1} OFFSET $${p.length}`;
    const { rows } = await query(sql, p);
    res.json({ users: rows });
  } catch(err) { next(err); }
});

router.patch("/users/:id/toggle", ...admin, async (req, res, next) => {
  try {
    const { rows:[u] } = await query(
      "UPDATE users SET is_active=NOT is_active WHERE id=$1 RETURNING id,name,is_active", [req.params.id]
    );
    if (!u) return res.status(404).json({ error:"User not found" });
    res.json({ message:`${u.name} ${u.is_active?"activated":"deactivated"}`, user:u });
  } catch(err) { next(err); }
});

router.post("/broadcast", ...admin, async (req, res, next) => {
  try {
    const { title, body, role } = req.body;
    let sql = "SELECT id FROM users WHERE is_active=TRUE";
    const p = role ? [role] : [];
    if (role) sql+=" AND role=$1";
    const { rows } = await query(sql, p);
    await notifSvc.sendToMultiple(rows.map(r=>r.id), { type:"system", title, body });
    res.json({ message:`Broadcast sent to ${rows.length} users` });
  } catch(err) { next(err); }
});

router.get("/payments", ...admin, async (req, res, next) => {
  try {
    const { status, page=1 } = req.query;
    let sql = `SELECT p.*,u.name AS user_name,u.phone FROM payments p JOIN users u ON u.id=p.user_id WHERE 1=1`;
    const p = [];
    if (status) { p.push(status); sql+=` AND p.status=$${p.length}`; }
    p.push(50,(page-1)*50);
    sql+=` ORDER BY p.created_at DESC LIMIT $${p.length-1} OFFSET $${p.length}`;
    const { rows } = await query(sql, p);
    res.json({ payments: rows });
  } catch(err) { next(err); }
});

module.exports = router;
