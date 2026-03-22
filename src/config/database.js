const { Pool } = require("pg");
const logger   = require("../utils/logger");

const pool = new Pool(
  process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false }
    : {
        host:     process.env.DB_HOST     || "localhost",
        port:     parseInt(process.env.DB_PORT) || 5432,
        database: process.env.DB_NAME     || "glogo_db",
        user:     process.env.DB_USER     || "postgres",
        password: process.env.DB_PASSWORD || "",
        ssl: false,
      }
);

pool.on("error", err => logger.error("PG pool error:", err.message));

async function connectDB() {
  const client = await pool.connect();
  await client.query("SELECT NOW()");
  client.release();
  logger.info("✅ PostgreSQL connected");
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    logger.error(`SQL error: ${err.message}`);
    throw err;
  }
}

async function getClient() {
  const client = await pool.connect();
  return client;
}

module.exports = { pool, connectDB, query, getClient };
