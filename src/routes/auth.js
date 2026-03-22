const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/authController");
const { authenticate } = require("../middleware/auth");

router.post("/register", ctrl.register);
router.post("/login",    ctrl.login);
router.post("/refresh",  ctrl.refresh);
router.post("/logout",   authenticate, ctrl.logout);

router.patch("/fcm-token", authenticate, function(req, res, next) {
  if (typeof ctrl.updateFcmToken === "function") {
    return ctrl.updateFcmToken(req, res, next);
  }
  res.json({ message: "FCM token skipped" });
});

module.exports = router;
