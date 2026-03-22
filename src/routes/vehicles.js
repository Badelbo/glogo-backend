const express = require("express");
const router  = express.Router();
const ctrl    = require("../controllers/vehicleController");
const { authenticate, authorize } = require("../middleware/auth");

router.get("/",                   ctrl.getAllVehicles);
router.get("/:id",                ctrl.getVehicle);
router.post("/:id/location",      authenticate, authorize("driver","admin"), ctrl.updateLocation);
router.patch("/:id/status",       authenticate, authorize("driver","admin"), ctrl.updateStatus);

module.exports = router;
