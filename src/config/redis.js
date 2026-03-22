const { createClient } = require("redis");
const logger = require("../utils/logger");

let redisClient = null;
let redisAvailable = false;

// In-memory fallback store when Redis is not available
const memStore = new Map();

async function connectRedis() {
  try {
    redisClient = createClient({
      url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST || "localhost"}:${process.env.REDIS_PORT || 6379}`,
    });
    redisClient.on("error", err => {
      if (redisAvailable) logger.warn("Redis error (using memory fallback):", err.message);
      redisAvailable = false;
    });
    redisClient.on("ready", () => { redisAvailable = true; logger.info("✅ Redis connected"); });
    await redisClient.connect();
    redisAvailable = true;
  } catch (err) {
    logger.warn("Redis unavailable — using in-memory fallback:", err.message);
    redisAvailable = false;
  }
}

// ── Queue helpers ─────────────────────────────────────────
async function addToQueue(stopId, vehicleId, userId) {
  const key   = `queue:${stopId}:${vehicleId}`;
  const score = Date.now();
  if (redisAvailable) {
    await redisClient.zAdd(key, { score, value: userId });
    await redisClient.expire(key, 3600);
  } else {
    const set = memStore.get(key) || [];
    if (!set.find(i => i.value === userId)) set.push({ score, value: userId });
    memStore.set(key, set);
  }
  return score;
}

async function getQueuePosition(stopId, vehicleId, userId) {
  const key = `queue:${stopId}:${vehicleId}`;
  if (redisAvailable) {
    const rank = await redisClient.zRank(key, userId);
    return rank === null ? null : rank + 1;
  }
  const set = (memStore.get(key) || []).sort((a,b) => a.score - b.score);
  const idx = set.findIndex(i => i.value === userId);
  return idx === -1 ? null : idx + 1;
}

async function getQueueLength(stopId, vehicleId) {
  const key = `queue:${stopId}:${vehicleId}`;
  if (redisAvailable) return await redisClient.zCard(key);
  return (memStore.get(key) || []).length;
}

async function removeFromQueue(stopId, vehicleId, userId) {
  const key = `queue:${stopId}:${vehicleId}`;
  if (redisAvailable) return await redisClient.zRem(key, userId);
  const set = (memStore.get(key) || []).filter(i => i.value !== userId);
  memStore.set(key, set);
}

// ── Vehicle location ──────────────────────────────────────
async function setVehicleLocation(vehicleId, lat, lng, heading) {
  const key  = `vloc:${vehicleId}`;
  const data = { lat: String(lat), lng: String(lng), heading: String(heading), ts: String(Date.now()) };
  if (redisAvailable) {
    await redisClient.hSet(key, data);
    await redisClient.expire(key, 60);
  } else {
    memStore.set(key, data);
  }
}

async function getVehicleLocation(vehicleId) {
  const key = `vloc:${vehicleId}`;
  const data = redisAvailable ? await redisClient.hGetAll(key) : memStore.get(key);
  if (!data || !data.lat) return null;
  return { lat: parseFloat(data.lat), lng: parseFloat(data.lng), heading: parseFloat(data.heading), ts: parseInt(data.ts) };
}

// ── Cache helpers ─────────────────────────────────────────
async function cacheSet(key, value, ttl = 60) {
  if (redisAvailable) await redisClient.setEx(key, ttl, JSON.stringify(value));
  else memStore.set(key, { val: value, exp: Date.now() + ttl * 1000 });
}

async function cacheGet(key) {
  if (redisAvailable) {
    const v = await redisClient.get(key);
    return v ? JSON.parse(v) : null;
  }
  const entry = memStore.get(key);
  if (!entry || Date.now() > entry.exp) return null;
  return entry.val;
}

async function cacheDel(key) {
  if (redisAvailable) await redisClient.del(key);
  else memStore.delete(key);
}

module.exports = {
  connectRedis,
  addToQueue, getQueuePosition, getQueueLength, removeFromQueue,
  setVehicleLocation, getVehicleLocation,
  cacheSet, cacheGet, cacheDel,
};
