const express = require("express");
const router  = express.Router();
const { authenticate } = require("../middleware/auth");
const { query } = require("../config/database");
const bcrypt    = require("bcryptjs");

router.get("/me", authenticate, async (req, res, next) => {
  try {
    const { rows:[u] } = await query(
      "SELECT id,phone,name,email,role,is_verified,created_at FROM users WHERE id=$1", [req.user.id]
    );
    res.json({ user: u });
  } catch(err) { next(err); }
});

router.patch("/me", authenticate, async (req, res, next) => {
  try {
    const { name, email } = req.body;
    const { rows:[u] } = await query(
      "UPDATE users SET name=COALESCE($1,name),email=COALESCE($2,email),updated_at=NOW() WHERE id=$3 RETURNING id,name,email,phone,role",
      [name||null, email||null, req.user.id]
    );
    res.json({ user: u });
  } catch(err) { next(err); }
});

router.patch("/me/password", authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const { rows:[u] } = await query("SELECT password_hash FROM users WHERE id=$1", [req.user.id]);
    const ok = await bcrypt.compare(currentPassword, u.password_hash);
    if (!ok) return res.status(400).json({ error:"Current password incorrect" });
    const hash = await bcrypt.hash(newPassword, 12);
    await query("UPDATE users SET password_hash=$1 WHERE id=$2", [hash, req.user.id]);
    res.json({ message:"Password updated" });
  } catch(err) { next(err); }
});

router.get("/me/trips", authenticate, async (req, res, next) => {
  try {
    const { rows } = await query(
      `SELECT qe.id,qe.queue_number,qe.status,qe.joined_at,qe.boarded_at,
              v.vehicle_code,v.route_name,v.type,
              p.amount,p.currency,p.method AS payment_method,p.status AS payment_status
       FROM queue_entries qe
       JOIN vehicles v ON v.id=qe.vehicle_id
       LEFT JOIN payments p ON p.queue_entry_id=qe.id
       WHERE qe.user_id=$1 ORDER BY qe.joined_at DESC LIMIT 50`,
      [req.user.id]
    );
    res.json({ trips: rows });
  } catch(err) { next(err); }
});

module.exports = router;
