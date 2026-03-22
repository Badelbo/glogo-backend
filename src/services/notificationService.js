const { query } = require("../config/database");
const logger     = require("../utils/logger");

// Firebase admin is optional — only init if credentials exist
let messaging = null;
try {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_PRIVATE_KEY) {
    const admin = require("firebase-admin");
    if (!admin.apps.length) {
      admin.initializeApp({ credential: admin.credential.cert({
        projectId:   process.env.FIREBASE_PROJECT_ID,
        privateKey:  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g,"\n"),
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      })});
    }
    messaging = admin.messaging();
    logger.info("✅ Firebase Admin initialised");
  } else {
    logger.warn("Firebase not configured — push notifications stored only");
  }
} catch(e) { logger.warn("Firebase init skipped:", e.message); }

async function sendToUser(userId, { type, title, body, data={} }) {
  try {
    // Always store in DB
    await query(
      `INSERT INTO notifications (id,user_id,type,title,body,data)
       VALUES (gen_random_uuid(),$1,$2,$3,$4,$5)`,
      [userId, type, title, body, JSON.stringify(data)]
    ).catch(()=>{}); // don't fail if table doesn't exist yet

    if (!messaging) return;
    const { rows:[u] } = await query("SELECT fcm_token FROM users WHERE id=$1", [userId]);
    if (!u?.fcm_token) return;

    await messaging.send({
      token: u.fcm_token,
      notification: { title, body },
      data: Object.fromEntries(Object.entries(data).map(([k,v])=>[k,String(v)])),
      android: { priority:"high" },
      apns: { payload:{ aps:{ sound:"default" }}},
    });
  } catch(err) {
    logger.error(`Push failed for ${userId}:`, err.message);
  }
}

async function sendToMultiple(userIds, payload) {
  await Promise.allSettled(userIds.map(uid => sendToUser(uid, payload)));
}

async function getUserNotifications(userId, page=1, limit=30) {
  const offset = (page-1)*limit;
  const { rows } = await query(
    `SELECT id,type,title,body,data,is_read,sent_at FROM notifications
     WHERE user_id=$1 ORDER BY sent_at DESC LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );
  return rows;
}

async function markRead(userId, ids) {
  await query(
    `UPDATE notifications SET is_read=TRUE,read_at=NOW()
     WHERE user_id=$1 AND id=ANY($2::uuid[])`,
    [userId, ids]
  );
}

module.exports = { sendToUser, sendToMultiple, getUserNotifications, markRead };
