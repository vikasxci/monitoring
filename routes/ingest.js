import { Router } from "express";
import crypto from "crypto";
import { requireDevice } from "../middleware/auth.js";
import Location from "../models/Location.js";
import AppUsage from "../models/AppUsage.js";
import NotificationLog from "../models/NotificationLog.js";
import Contact from "../models/Contact.js";

const router = Router();

// Every ingest route requires a valid device token.
router.use(requireDevice);

// POST /api/ingest/locations  { items: [{lat,lng,accuracy,altitude,speed,recordedAt}] }
router.post("/locations", async (req, res) => {
  const { items = [] } = req.body || {};
  const deviceId = req.device.deviceId;
  if (!items.length) return res.json({ inserted: 0 });
  const docs = items.map((i) => ({ ...i, deviceId }));
  const r = await Location.insertMany(docs, { ordered: false }).catch(() => []);
  res.json({ inserted: r.length });
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
    // The app's `key` (Android's sbn.key) is reused for the same notification
    // slot, so two different messages from the same app — often with the same
    // title/appLabel — would collide and overwrite each other. Derive the dedup
    // key from the message content + postedAt so each distinct notification is
    // stored separately, while a true re-send of the identical notification
    // (same content + time) still de-duplicates.
    const dedupeKey = crypto
      .createHash("sha1")
      .update(
        [
          i.packageName || "",
          i.appLabel || "",
          i.title || "",
          i.text || "",
          i.postedAt || "",
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
  if (ops.length)
    await NotificationLog.bulkWrite(ops, { ordered: false }).catch(() => {});
  res.json({ upserted: ops.length });
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

export default router;
