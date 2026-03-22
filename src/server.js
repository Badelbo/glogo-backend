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

const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3000",
  "http://localhost:3000",
  "http://localhost:3001",
  "https://www.glogogh.com",
  "https://glogogh.com",
  "https://glogo-frontend.vercel.app",
  "https://glogo-frontend-git-main-badelbos-projects.vercel.app",
];

const io = new Server(server, {
  cors: { origin: allowedOrigins, methods: ["GET","POST"], credentials: true }
});
socketHandler(io);
app.set("io", io);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: allowedOrigins, credentials: true }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev"));

const limiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300 });
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30,
  message: { error: "Too many attempts. Try again in 15 minutes." }
});

app.use("/api", limiter);
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);

// Health
app.get("/",      (_req, res) => res.json({ app: "Glogo API", status: "ok", version: "1.0.0" }));
app.get("/health",(_req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Routes
app.use("/api/auth",          authRoutes);
app.use("/api/users",         userRoutes);
app.use("/api/vehicles",      vehicleRoutes);
app.use("/api/queues",        queueRoutes);
app.use("/api/stops",         stopRoutes);
app.use("/api/payments",      paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/drivers",       driverRoutes);
app.use("/api/admin",         adminRoutes);

app.use("*", (_req, res) => res.status(404).json({ error: "Not found" }));
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    await connectRedis();
    server.listen(PORT, () => {
      logger.info(`🚌 Glogo Backend on port ${PORT} [${process.env.NODE_ENV}]`);
    });
  } catch (err) {
    logger.error("Failed to start:", err.message);
    process.exit(1);
  }
}

start();
module.exports = { app, server };
