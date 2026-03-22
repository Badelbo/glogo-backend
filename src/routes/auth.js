// ─── routes/auth.js ─────────────────────────────────────
const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");
router.post("/register",   ctrl.register);
router.post("/login",      ctrl.login);
router.post("/refresh",    ctrl.refresh);
router.post("/logout",     authenticate, ctrl.logout);
router.patch("/fcm-token", authenticate, ctrl.updateFcm);
module.exports = router;
