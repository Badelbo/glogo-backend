const express = require("express");
const router  = express.Router();
const { query } = require("../config/database");
const { authenticate, authorize } = require("../middleware/auth");
const { cacheGet, cacheSet } = require("../config/redis");
const { v4: uuid } = require("uuid");

router.get("/", async (req, res, next) => {
  try {
    const cached = await cacheGet("stops:all");
    if (cached) return res.json(cached);
    const { rows } = await query(
      `SELECT s.*,
         (SELECT COUNT(*) FROM queue_entries qe WHERE qe.stop_id=s.id AND qe.status IN ('waiting','ready')) AS queue_count
       FROM stops s WHERE s.is_active=TRUE ORDER BY s.name`
    );
    const result = { stops: rows };
    await cacheSet("stops:all", result, 30);
    res.json(result);
  } catch(err) { next(err); }
});

router.get("/:id", async (req, res, next) => {
  try {
    const { rows:[stop] } = await query("SELECT * FROM stops WHERE id=$1", [req.params.id]);
    if (!stop) return res.status(404).json({ error:"Stop not found" });
    const { rows:vehicles } = await query(
      "SELECT id,vehicle_code,type,status,route_name,fare,capacity FROM vehicles WHERE current_stop_id=$1 AND is_active=TRUE",
      [req.params.id]
    );
    res.json({ stop, vehicles });
  } catch(err) { next(err); }
});

router.post("/", authenticate, authorize("admin"), async (req, res, next) => {
  try {
    const { name, city="Kumasi", region="Ashanti", lat, lng } = req.body;
    const { rows:[s] } = await query(
      "INSERT INTO stops (id,name,city,region,lat,lng) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
      [uuid(), name, city, region, lat, lng]
    );
    res.status(201).json({ stop: s });
  } catch(err) { next(err); }
});

module.exports = router;
