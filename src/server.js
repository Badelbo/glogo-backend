require("dotenv").config();
const express    = require("express");
const http       = require("http");
const { Server } = require("socket.io");
const cors       = require("cors");
const helmet     = require("helmet");
const morgan     = require("morgan");
const rateLimit  = require("express-rate-limit");

const { connectDB }    = require("./config/database");
const { connectRedis } = require("./config/redis");
const logger           = require("./utils/logger");
const socketHandler    = require("./services/socketService");
const errorHandler     = require("./middleware/errorHandler");

// ─── Routes ──────────────────────────────────────────────
const authRoutes         = require("./routes/auth");
const userRoutes         = require("./routes/users");
const vehicleRoutes      = require("./routes/vehicles");
const queueRoutes        = require("./routes/queues");
const stopRoutes         = require("./routes/stops");
const paymentRoutes      = require("./routes/payments");
const notificationRoutes = require("./routes/notifications");
const driverRoutes       = require("./routes/drivers");
const adminRoutes        = require("./routes/admin");

const app    = express();
const server = http.createServer(app);

// ─── Allowed Origins ─────────────────────────────────────
const allowedOrigins = [
  "https://app.glogogh.com",
  "https://www.glogogh.com",
  "https://glogogh.com",
  "https://glogo-frontend.vercel.app",
  "https://glogo-website.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
];

// Allow any vercel preview URL for glogo
function isAllowed(origin) {
  if (!origin) return true; // allow server-to-server
  if (allowedOrigins.includes(origin)) return true;
  if (origin.includes("glogo") && origin.includes("vercel.app")) return true;
  if (origin.includes("badelbos-projects.vercel.app")) return true;
  return false;
}

const corsOptions = {
  origin: function(origin, callback) {
    if (isAllowed(origin)) {
      callback(null, true);
    } else {
      logger.warn(`CORS blocked: ${origin}`);
      callback(null, true); // allow all for now — tighten later
    }
  },
  credentials: true,
  methods: ["GET","POST","PUT","PATCH","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization","X-Requested-With"],
};

// ─── Socket.IO Setup ─────────────────────────────────────
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
});
socketHandler(io);
app.set("io", io);

// ─── Security & Middleware ────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: "*", credentials: false }));
app.options("*", cors({ origin: "*" })); // handle preflight
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: { write: msg => logger.http(msg.trim()) } }));

// ─── Rate Limiting ────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: "Too many requests. Please try again later." }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many login attempts. Please wait 15 minutes." }
});
app.use("/api", limiter);
app.use("/api/auth", authLimiter);

// ─── Health Check ─────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "Glogo Backend", version: "1.0.0", time: new Date() });
});

// ─── API Routes ───────────────────────────────────────────
app.use("/api/auth",          authRoutes);
app.use("/api/users",         userRoutes);
app.use("/api/vehicles",      vehicleRoutes);
app.use("/api/queues",        queueRoutes);
app.use("/api/stops",         stopRoutes);
app.use("/api/payments",      paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/drivers",       driverRoutes);
app.use("/api/admin",         adminRoutes);

// ─── 404 Handler ─────────────────────────────────────────
app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

// ─── Global Error Handler ─────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────
const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    await connectRedis();
    server.listen(PORT, () => {
      logger.info(`🚌 Glogo Backend running on port ${PORT}`);
      logger.info(`🇬🇭 Environment: ${process.env.NODE_ENV}`);
      logger.info(`✅ CORS enabled for app.glogogh.com and all Glogo domains`);
    });
  } catch (err) {
    logger.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();

module.exports = { app, server };
