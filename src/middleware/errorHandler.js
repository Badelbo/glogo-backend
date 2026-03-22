const logger = require("../utils/logger");

module.exports = function errorHandler(err, req, res, next) {
  logger.error(`${req.method} ${req.path} — ${err.message}`);
  if (err.code === "23505") return res.status(409).json({ error: "Already exists" });
  if (err.code === "23503") return res.status(400).json({ error: "Referenced record not found" });
  if (err.name === "JsonWebTokenError") return res.status(401).json({ error: "Invalid token" });
  const status  = err.status || err.statusCode || 500;
  const message = err.message || "Internal server error";
  res.status(status).json({ error: message });
};
