import { Router } from "express";
import crypto from "crypto";
import { requireDevice } from "../middleware/auth.js";
import Location from "../models/Location.js";
import AppUsage from "../models/AppUsage.js";
import NotificationLog from "../models/NotificationLog.js";
import Contact from "../models/Contact.js";
import CallLog from "../models/CallLog.js";

const router = Router();

// Every ingest route requires a valid device token.
router.use(requireDevice);

// POST /api/ingest/locations  { items: [{lat,lng,accuracy,altitude,speed,recordedAt}] }
router.post("/locations", async (req, res) => {
  const { items = [] } = req.body || {};
  const deviceId = req.device.deviceId;
  const model = req.device.model || "?";

  console.log(
    `[ingest] locations <- device=${deviceId} (${model}) items=${items.length}`
  );

  if (!items.length) {
    // The phone reached us and authed fine, but sent an empty batch — i.e. it
    // never got a location fix to send. That's a device-side GPS problem, and
    // logging it here is how we tell it apart from "nothing arrived at all".
    console.warn(`[ingest] locations: EMPTY batch from device=${deviceId}`);
    return res.json({ inserted: 0 });
  }

  const docs = items.map((i) => ({ ...i, deviceId }));
  try {
    // ordered:false so one bad row never blocks the rest of the batch.
    const r = await Location.insertMany(docs, { ordered: false, rawResult: true });
    const inserted = r.insertedCount ?? (r.insertedIds ? Object.keys(r.insertedIds).length : 0);
    console.log(`[ingest] locations: stored ${inserted}/${items.length} for device=${deviceId}`);
    return res.json({ inserted });
  } catch (err) {
    // Some rows may still have inserted; surface how many, and WHY the rest
    // failed, instead of swallowing it and returning a misleading 200.
    const inserted = err.insertedDocs?.length || err.result?.result?.nInserted || 0;
    const writeErrors = err.writeErrors || [];
    const first = writeErrors[0];
    console.error(
      `[ingest] locations FAILED for device=${deviceId}: inserted=${inserted}/${items.length}` +
        (first ? ` firstError="${first.errmsg || first.err?.errmsg || err.message}"` : ` ${err.message}`)
    );
    // Non-2xx so the phone's lastError shows "HTTP 500" instead of a silent success.
    return res.status(500).json({ inserted, error: "location ingest failed" });
  }
});

// POST /api/ingest/usage  { day, items: [{packageName,appLabel,totalTimeMs,lastUsedAt,launchCount}] }
router.post("/usage", async (req, res) => {
  const { day, items = [] } = req.body || {};
  const deviceId = req.device.deviceId;
  const ops = items.map((i) => ({
    updateOne: {
      filter: { deviceId, day, packageName: i.packageName },
      update: { $set: { ...i, deviceId, day } },
      upsert: true,
    },
  }));
  if (ops.length) await AppUsage.bulkWrite(ops, { ordered: false }).catch(() => {});
  res.json({ upserted: ops.length });
});

// POST /api/ingest/notifications  { items: [{key,packageName,appLabel,title,text,category,postedAt}] }
router.post("/notifications", async (req, res) => {
  const { items = [] } = req.body || {};
  const deviceId = req.device.deviceId;
  const ops = items.map((i) => {
    // Bucket the post time to the SECOND. Apps like WhatsApp re-post the exact
    // same notification a few milliseconds apart (bumping a counter / re-emitting
    // MessagingStyle); those reposts land in the same second and collapse to one
    // row. A per-second bucket is deliberately fine-grained so we NEVER merge two
    // genuinely distinct notifications — that would require identical app, title
    // and text within the very same second, which real messages do not produce.
    const secondBucket = i.postedAt
      ? new Date(i.postedAt).toISOString().slice(0, 19) // YYYY-MM-DDTHH:mm:ss
      : "";
    const dedupeKey = crypto
      .createHash("sha1")
      .update(
        [
          i.packageName || "",
          i.appLabel || "",
          i.title || "",
          i.text || "",
          secondBucket,
        ].join("\u0000")
      )
      .digest("hex");
    return {
      updateOne: {
        filter: { deviceId, key: dedupeKey },
        update: { $set: { ...i, deviceId, key: dedupeKey } },
        upsert: true,
      },
    };
  });
  if (!ops.length) return res.json({ received: 0, stored: 0 });

  try {
    // ordered:false so one duplicate in a batch never blocks the rest.
    const r = await NotificationLog.bulkWrite(ops, { ordered: false });
    const stored = (r.upsertedCount || 0) + (r.modifiedCount || 0);
    return res.json({ received: ops.length, stored });
  } catch (err) {
    // A duplicate-key (E11000) within a batch is expected and harmless — the
    // other writes still commit. Surface anything else instead of swallowing
    // it, so a real failure can't silently produce "nothing lands in the DB".
    const res0 = err.result?.result || {};
    const stored = (res0.nUpserted || 0) + (res0.nModified || 0);
    const nonDup = (err.writeErrors || []).filter((e) => e.code !== 11000);
    if (nonDup.length) {
      console.error(
        "[ingest] notifications bulkWrite error:",
        nonDup[0].errmsg || err.message
      );
      return res.status(500).json({ error: "ingest failed", stored });
    }
    return res.json({ received: ops.length, stored });
  }
});

// POST /api/ingest/contacts  { items: [{contactId,name,phones,emails}] }
router.post("/contacts", async (req, res) => {
  const { items = [] } = req.body || {};
  const deviceId = req.device.deviceId;
  const ops = items.map((i) => ({
    updateOne: {
      filter: { deviceId, contactId: i.contactId },
      update: { $set: { ...i, deviceId } },
      upsert: true,
    },
  }));
  if (ops.length) await Contact.bulkWrite(ops, { ordered: false }).catch(() => {});
  res.json({ upserted: ops.length });
});

// POST /api/ingest/calllogs  { items: [{callId,number,name,type,durationSec,timestamp}] }
router.post("/calllogs", async (req, res) => {
  const { items = [] } = req.body || {};
  const deviceId = req.device.deviceId;
  const ops = items.map((i) => ({
    updateOne: {
      filter: { deviceId, callId: i.callId },
      update: { $set: { ...i, deviceId } },
      upsert: true,
    },
  }));
  if (!ops.length) return res.json({ received: 0, upserted: 0 });

  try {
    // ordered:false so one bad/duplicate row never blocks the rest of the batch.
    const r = await CallLog.bulkWrite(ops, { ordered: false });
    const upserted = (r.upsertedCount || 0) + (r.modifiedCount || 0);
    return res.json({ received: ops.length, upserted });
  } catch (err) {
    const res0 = err.result?.result || {};
    const upserted = (res0.nUpserted || 0) + (res0.nModified || 0);
    const nonDup = (err.writeErrors || []).filter((e) => e.code !== 11000);
    if (nonDup.length) {
      console.error(
        "[ingest] calllogs bulkWrite error:",
        nonDup[0].errmsg || err.message
      );
      return res.status(500).json({ error: "ingest failed", upserted });
    }
    return res.json({ received: ops.length, upserted });
  }
});

export default router;
