const { query, getClient } = require("../config/database");
const { v4: uuid } = require("uuid");
const notifSvc    = require("../services/notificationService");
const logger       = require("../utils/logger");

// ── Payment simulation for sandbox/dev ───────────────────
async function simulatePayment(paymentId, userId, queueEntryId, amount, io) {
  await new Promise(r => setTimeout(r, 2000)); // simulate 2s processing
  await query("UPDATE payments SET status='success',updated_at=NOW() WHERE id=$1", [paymentId]);
  await query("UPDATE queue_entries SET status='ready',ready_at=NOW() WHERE id=$1", [queueEntryId]);
  await notifSvc.sendToUser(userId, {
    type:"payment_success", title:"Payment Confirmed! ✅",
    body:`GHS ${amount} paid. Your spot is secured. Board when called!`,
    data:{ paymentId, queueEntryId }
  });
  io?.to(`user:${userId}`).emit("payment:success", { paymentId, queueEntryId });
}

async function initiatePayment(req, res, next) {
  const client = await getClient();
  try {
    const { queueEntryId, method, phoneNumber } = req.body;
    const userId = req.user.id;
    if (!queueEntryId || !method) return res.status(400).json({ error: "queueEntryId and method required" });

    const { rows:[entry] } = await client.query(
      `SELECT qe.id,qe.status,qe.vehicle_id,v.fare,v.route_name,v.vehicle_code
       FROM queue_entries qe JOIN vehicles v ON v.id=qe.vehicle_id
       WHERE qe.id=$1 AND qe.user_id=$2`,
      [queueEntryId, userId]
    );
    if (!entry) return res.status(404).json({ error: "Queue entry not found" });
    if (!["waiting","ready"].includes(entry.status))
      return res.status(400).json({ error: "Cannot pay for this entry" });

    const alreadyPaid = await client.query(
      "SELECT id FROM payments WHERE queue_entry_id=$1 AND status='success'", [queueEntryId]
    );
    if (alreadyPaid.rows[0]) return res.status(409).json({ error: "Fare already paid" });

    const paymentId = uuid();
    const amount    = parseFloat(entry.fare);

    await client.query(
      `INSERT INTO payments (id,user_id,queue_entry_id,amount,currency,method,status,phone_number,description)
       VALUES ($1,$2,$3,$4,'GHS',$5,'pending',$6,$7)`,
      [paymentId, userId, queueEntryId, amount, method, phoneNumber||null,
       `Fare — ${entry.vehicle_code} ${entry.route_name}`]
    );

    const io = req.app.get("io");

    // In sandbox/dev simulate payment success; in production call real APIs
    if (process.env.NODE_ENV !== "production" || process.env.PAYMENT_MODE === "sandbox") {
      simulatePayment(paymentId, userId, queueEntryId, amount, io); // async, don't await
      logger.info(`Simulated payment: ${paymentId} GHS ${amount}`);
    } else {
      // Real MTN / Airtel integration would go here (call external APIs)
      // See mtnMomoService.js & airtelService.js
    }

    res.status(202).json({ message:"Payment initiated", paymentId, amount, currency:"GHS" });
  } catch(err) { next(err); }
}

async function getPayment(req, res, next) {
  try {
    const { rows:[p] } = await query(
      "SELECT id,amount,currency,method,status,provider_ref,created_at FROM payments WHERE id=$1 AND user_id=$2",
      [req.params.id, req.user.id]
    );
    if (!p) return res.status(404).json({ error: "Payment not found" });
    res.json({ payment: p });
  } catch(err) { next(err); }
}

async function paymentHistory(req, res, next) {
  try {
    const { page=1, limit=20 } = req.query;
    const offset = (page-1)*limit;
    const { rows } = await query(
      `SELECT p.id,p.amount,p.currency,p.method,p.status,p.provider_ref,p.created_at,
              v.route_name,v.vehicle_code
       FROM payments p
       LEFT JOIN queue_entries qe ON qe.id=p.queue_entry_id
       LEFT JOIN vehicles v ON v.id=qe.vehicle_id
       WHERE p.user_id=$1 ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [req.user.id, limit, offset]
    );
    const {rows:[{count}]} = await query("SELECT COUNT(*) FROM payments WHERE user_id=$1", [req.user.id]);
    res.json({ payments:rows, total:parseInt(count), page:parseInt(page) });
  } catch(err) { next(err); }
}

// MTN webhook (production)
async function mtnWebhook(req, res, next) {
  try {
    const { externalId, status, financialTransactionId } = req.body;
    const { rows:[p] } = await query("SELECT id,user_id,queue_entry_id,amount FROM payments WHERE id=$1", [externalId]);
    if (!p) return res.status(404).json({ ok:false });
    const newStatus = status==="SUCCESSFUL" ? "success" : "failed";
    await query("UPDATE payments SET status=$1,provider_ref=$2 WHERE id=$3", [newStatus, financialTransactionId||null, p.id]);
    if (newStatus==="success") {
      await query("UPDATE queue_entries SET status='ready',ready_at=NOW() WHERE id=$1", [p.queue_entry_id]);
      await notifSvc.sendToUser(p.user_id, { type:"payment_success", title:"Paid! ✅", body:`GHS ${p.amount} confirmed.` });
    }
    res.json({ ok: true });
  } catch(err) { next(err); }
}

module.exports = { initiatePayment, getPayment, paymentHistory, mtnWebhook };
