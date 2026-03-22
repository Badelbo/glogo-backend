const bcrypt = require("bcryptjs");
const jwt    = require("jsonwebtoken");
const { v4: uuidv4 } = require("uuid");
const { query } = require("../config/database");
const logger     = require("../utils/logger");

function generateTokens(userId) {
  const access = jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "7d"
  });
  const refresh = jwt.sign({ id: userId }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d"
  });
  return { access, refresh };
}

const TYPE_CAPACITY = {
  trotro: 18, shared_taxi: 4, taxi: 4, mini_bus: 25, metro_bus: 45,
};

async function register(req, res, next) {
  try {
    const {
      phone, name, email, password, role = "commuter",
      vehicleType, plateNumber, routeName, fare, licenseNumber,
    } = req.body;

    if (!["commuter", "driver"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const existing = await query("SELECT id FROM users WHERE phone = $1", [phone]);
    if (existing.rows[0]) {
      return res.status(409).json({ error: "Phone number already registered" });
    }

    const hash   = await bcrypt.hash(password, 12);
    const userId = uuidv4();
    const { rows } = await query(
      `INSERT INTO users (id,phone,name,email,password_hash,role)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id,phone,name,role,created_at`,
      [userId, phone, name, email || null, hash, role]
    );

    const { access, refresh } = generateTokens(userId);
    await query("UPDATE users SET refresh_token = $1 WHERE id = $2", [refresh, userId]);

    if (role === "driver") {
      const driverId = uuidv4();
      await query(
        `INSERT INTO drivers (id,user_id,license_number,license_expiry,is_verified)
         VALUES ($1,$2,$3,'2027-12-31',FALSE)`,
        [driverId, userId, licenseNumber || "PENDING"]
      );

      if (plateNumber && routeName) {
        const vType    = vehicleType || "trotro";
        const capacity = TYPE_CAPACITY[vType] || 18;
        const vFare    = parseFloat(fare) || 2.50;
        const code     = plateNumber.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);

        await query(
          `INSERT INTO vehicles
             (id,vehicle_code,type,plate_number,capacity,driver_id,route_name,fare,status,is_active)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'idle',TRUE)
           ON CONFLICT (plate_number) DO UPDATE
             SET driver_id=$6,route_name=$7,fare=$8,status='idle',is_active=TRUE,updated_at=NOW()`,
          [uuidv4(), code, vType, plateNumber, capacity, driverId, routeName, vFare]
        );
      }
    }

    res.status(201).json({
      message: role === "driver"
        ? "Driver registered! Welcome to Glogo!"
        : "Registration successful. Welcome to Glogo!",
      user:   rows[0],
      tokens: { access, refresh },
    });
  } catch (err) { next(err); }
}

async function login(req, res, next) {
  try {
    const { phone, password } = req.body;
    const { rows } = await query(
      "SELECT id,phone,name,role,password_hash,is_active FROM users WHERE phone = $1",
      [phone]
    );
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid phone or password" });
    if (!user.is_active) return res.status(403).json({ error: "Account deactivated. Contact support." });

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid phone or password" });

    const { access, refresh } = generateTokens(user.id);
    await query("UPDATE users SET refresh_token = $1 WHERE id = $2", [refresh, user.id]);

    res.json({
      message: "Akwaaba!",
      user: { id: user.id, phone: user.phone, name: user.name, role: user.role },
      tokens: { access, refresh },
    });
  } catch (err) { next(err); }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ error: "Refresh token required" });

    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    const { rows } = await query(
      "SELECT id,refresh_token FROM users WHERE id = $1", [decoded.id]
    );
    const user = rows[0];
    if (!user || user.refresh_token !== refreshToken) {
      return res.status(401).json({ error: "Invalid refresh token" });
    }

    const { access, refresh: newRefresh } = generateTokens(user.id);
    await query("UPDATE users SET refresh_token = $1 WHERE id = $2", [newRefresh, user.id]);
    res.json({ tokens: { access, refresh: newRefresh } });
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Refresh token expired. Please login again." });
    }
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    await query("UPDATE users SET refresh_token = NULL WHERE id = $1", [req.user.id]);
    res.json({ message: "Logged out successfully" });
  } catch (err) { next(err); }
}

async function updateFcmToken(req, res, next) {
  try {
    const { fcmToken } = req.body;
    await query("UPDATE users SET fcm_token = $1 WHERE id = $2", [fcmToken, req.user.id]);
    res.json({ message: "FCM token updated" });
  } catch (err) { next(err); }
}

module.exports = { register, login, refresh, logout, updateFcmToken };
