import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import Device from "../models/Device.js";
import Location from "../models/Location.js";
import AppUsage from "../models/AppUsage.js";
import NotificationLog from "../models/NotificationLog.js";
import Contact from "../models/Contact.js";

const router = Router();
router.use(requireAdmin);

// List enrolled devices + high-level stats.
router.get("/devices", async (req, res) => {
  const devices = await Device.find().lean();
  const out = await Promise.all(
    devices.map(async (d) => ({
      deviceId: d.deviceId,
      label: d.label,
      model: d.model,
      androidVersion: d.androidVersion,
      battery: d.battery,
      lastSeenAt: d.lastSeenAt,
      consentAcceptedAt: d.consentAcceptedAt,
      counts: {
        locations: await Location.countDocuments({ deviceId: d.deviceId }),
        notifications: await NotificationLog.countDocuments({ deviceId: d.deviceId }),
        contacts: await Contact.countDocuments({ deviceId: d.deviceId }),
      },
    }))
  );
  res.json({ devices: out });
});

router.get("/:deviceId/summary", async (req, res) => {
  const { deviceId } = req.params;
  const day = new Date().toISOString().slice(0, 10);
  const [device, lastLoc, topApps, recentNotifs, contactsCount] = await Promise.all([
    Device.findOne({ deviceId }).lean(),
    Location.findOne({ deviceId }).sort({ recordedAt: -1 }).lean(),
    AppUsage.find({ deviceId, day }).sort({ totalTimeMs: -1 }).limit(8).lean(),
    NotificationLog.find({ deviceId }).sort({ postedAt: -1 }).limit(10).lean(),
    Contact.countDocuments({ deviceId }),
  ]);
  res.json({ device, lastLocation: lastLoc, topApps, recentNotifs, contactsCount, day });
});

router.get("/:deviceId/locations", async (req, res) => {
  const { deviceId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 500, 5000);
  const items = await Location.find({ deviceId })
    .sort({ recordedAt: -1 })
    .limit(limit)
    .lean();
  res.json({ items });
});

router.get("/:deviceId/usage", async (req, res) => {
  const { deviceId } = req.params;
  const day = req.query.day || new Date().toISOString().slice(0, 10);
  const items = await AppUsage.find({ deviceId, day }).sort({ totalTimeMs: -1 }).lean();
  res.json({ day, items });
});

router.get("/:deviceId/notifications", async (req, res) => {
  const { deviceId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 200, 2000);
  const q = { deviceId };
  if (req.query.package) q.packageName = req.query.package;
  const items = await NotificationLog.find(q).sort({ postedAt: -1 }).limit(limit).lean();
  res.json({ items });
});

router.get("/:deviceId/contacts", async (req, res) => {
  const { deviceId } = req.params;
  const items = await Contact.find({ deviceId }).sort({ name: 1 }).lean();
  res.json({ items });
});

export default router;
