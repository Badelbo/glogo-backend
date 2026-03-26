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

// Allow ALL origins
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }
});
socketHandler(io);
app.set("io", io);

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({ origin: "*", credentials: false }));
app.options("*", cors({ origin: "*" }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: { write: msg => logger.http(msg.trim()) } }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: "Too many requests." }
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  message: { error: "Too many login attempts." }
});
app.use("/api", limiter);
app.use("/api/auth", authLimiter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", app: "Glogo Backend", version: "1.0.0", time: new Date() });
});

app.use("/api/auth",          authRoutes);
app.use("/api/users",         userRoutes);
app.use("/api/vehicles",      vehicleRoutes);
app.use("/api/queues",        queueRoutes);
app.use("/api/stops",         stopRoutes);
app.use("/api/payments",      paymentRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/drivers",       driverRoutes);
app.use("/api/admin",         adminRoutes);

app.use("*", (req, res) => {
  res.status(404).json({ error: "Route not found" });
});

app.use(errorHandler);

const PORT = process.env.PORT || 5000;

async function start() {
  try {
    await connectDB();
    await connectRedis();
    server.listen(PORT, () => {
      logger.info("Glogo Backend running on port " + PORT);
    });
  } catch (err) {
    logger.error("Failed to start:", err);
    process.exit(1);
  }
}

start();

module.exports = { app, server };
