const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const { v4: uuid } = require("uuid");
const { query } = require("../config/database");
const logger     = require("../utils/logger");

function makeTokens(id) {
  const access  = jwt.sign({ id }, process.env.JWT_SECRET,         { expiresIn: process.env.JWT_EXPIRES_IN || "7d" });
  const refresh = jwt.sign({ id }, process.env.JWT_REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d" });
  return { access, refresh };
}

async function register(req, res, next) {
  try {
    const { phone, name, email, password, role = "commuter" } = req.body;
    if (!phone || !name || !password) return res.status(400).json({ error: "phone, name and password are required" });
    if (!["commuter","driver"].includes(role)) return res.status(400).json({ error: "Invalid role" });

    const exists = await query("SELECT id FROM users WHERE phone=$1", [phone]);
    if (exists.rows[0]) return res.status(409).json({ error: "Phone already registered" });

    const id   = uuid();
    const hash = await bcrypt.hash(password, 12);
    const { rows:[u] } = await query(
      `INSERT INTO users (id,phone,name,email,password_hash,role) VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id,phone,name,role,created_at`,
      [id, phone, name, email||null, hash, role]
    );
    const tokens = makeTokens(id);
    await query("UPDATE users SET refresh_token=$1 WHERE id=$2", [tokens.refresh, id]);
    logger.info(`Registered: ${phone} (${role})`);
    res.status(201).json({ message:"Welcome to Glogo! 🇬🇭", user:u, tokens });
  } catch(err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { phone, password } = req.body;
    if (!phone || !password) return res.status(400).json({ error: "phone and password required" });
    const { rows:[u] } = await query(
      "SELECT id,phone,name,role,password_hash,is_active FROM users WHERE phone=$1", [phone]
    );
    if (!u)           return res.status(401).json({ error: "Invalid phone or password" });
    if (!u.is_active) return res.status(403).json({ error: "Account deactivated" });
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid phone or password" });
    const tokens = makeTokens(u.id);
    await query("UPDATE users SET refresh_token=$1 WHERE id=$2", [tokens.refresh, u.id]);
    logger.info(`Login: ${phone}`);
    res.json({ message:"Akwaaba! 🇬🇭", user:{ id:u.id, phone:u.phone, name:u.name, role:u.role }, tokens });
  } catch(err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows:[u] } = await query("SELECT id,refresh_token FROM users WHERE id=$1", [decoded.id]);
    if (!u || u.refresh_token !== refreshToken)
      return res.status(401).json({ error: "Invalid refresh token" });
    const tokens = makeTokens(u.id);
    await query("UPDATE users SET refresh_token=$1 WHERE id=$2", [tokens.refresh, u.id]);
    res.json({ tokens });
  } catch(err) {
    if (err.name==="TokenExpiredError") return res.status(401).json({ error:"Refresh token expired. Login again." });
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await query("UPDATE users SET refresh_token=NULL WHERE id=$1", [req.user.id]);
    res.json({ message:"Logged out" });
  } catch(err) { next(err); }
}

async function updateFcm(req, res, next) {
  try {
    const { fcmToken } = req.body;
    await query("UPDATE users SET fcm_token=$1 WHERE id=$2", [fcmToken, req.user.id]);
    res.json({ ok: true });
  } catch(err) { next(err); }
}

module.exports = { register, login, refresh, logout, updateFcm };
