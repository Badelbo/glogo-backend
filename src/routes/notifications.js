const express  = require("express");
const router   = express.Router();
const { authenticate } = require("../middleware/auth");
const notifSvc = require("../services/notificationService");
const { query }= require("../config/database");

router.get("/", authenticate, async (req, res, next) => {
  try {
    const { page=1 } = req.query;
    const notifications = await notifSvc.getUserNotifications(req.user.id, parseInt(page));
    const { rows:[{count}] } = await query(
      "SELECT COUNT(*) FROM notifications WHERE user_id=$1 AND is_read=FALSE", [req.user.id]
    );
    res.json({ notifications, unread: parseInt(count) });
  } catch(err) { next(err); }
});

router.patch("/read", authenticate, async (req, res, next) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids)||!ids.length) return res.status(400).json({ error:"ids array required" });
    await notifSvc.markRead(req.user.id, ids);
    res.json({ ok: true });
  } catch(err) { next(err); }
});

router.patch("/read-all", authenticate, async (req, res, next) => {
  try {
    await query("UPDATE notifications SET is_read=TRUE,read_at=NOW() WHERE user_id=$1 AND is_read=FALSE", [req.user.id]);
    res.json({ ok: true });
  } catch(err) { next(err); }
});

module.exports = router;
