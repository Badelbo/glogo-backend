const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/queueController");
const { authenticate, authorize } = require("../middleware/auth");

router.post("/join",                  authenticate, ctrl.joinQueue);
router.get("/my",                     authenticate, ctrl.myQueues);
router.delete("/:entryId/leave",      authenticate, ctrl.leaveQueue);
router.get("/:vehicleId/:stopId",     ctrl.getVehicleQueue);
router.patch("/:entryId/board",       authenticate, authorize("driver","admin"), ctrl.markBoarded);

module.exports = router;
