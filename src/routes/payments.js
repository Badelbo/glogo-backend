const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/paymentController");
const { authenticate } = require("../middleware/auth");

router.post("/initiate",       authenticate, ctrl.initiatePayment);
router.get("/history",         authenticate, ctrl.paymentHistory);
router.get("/:id",             authenticate, ctrl.getPayment);
router.post("/webhook/mtn",    ctrl.mtnWebhook);

module.exports = router;
