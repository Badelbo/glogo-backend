const jwt    = require("jsonwebtoken");
const { query } = require("../config/database");

async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "No token provided" });
    const token   = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const { rows: [user] } = await query(
      "SELECT id,name,phone,role,is_active FROM users WHERE id=$1", [decoded.id]
    );
    if (!user)          return res.status(401).json({ error: "User not found" });
    if (!user.is_active)return res.status(403).json({ error: "Account deactivated" });
    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") return res.status(401).json({ error: "Token expired" });
    return res.status(401).json({ error: "Invalid token" });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: `Access denied. Requires: ${roles.join(" or ")}` });
    next();
  };
}

module.exports = { authenticate, authorize };
