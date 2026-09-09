import { Router } from "express";
import { requireAdmin } from "../middleware/auth.js";
import Device from "../models/Device.js";
import Location from "../models/Location.js";
import AppUsage from "../models/AppUsage.js";
import NotificationLog from "../models/NotificationLog.js";
import Contact from "../models/Contact.js";
import CallLog from "../models/CallLog.js";

const router = Router();
router.use(requireAdmin);

// Escapes user input for safe use inside a RegExp (prevents both regex
// injection and a crash from an unbalanced pattern like a stray "(").
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Shared page/pageSize parsing for the paginated list endpoints below.
function pageParams(req) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(Math.max(parseInt(req.query.pageSize, 10) || 50, 1), 200);
  return { page, pageSize };
}

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
        callLogs: await CallLog.countDocuments({ deviceId: d.deviceId }),
      },
    }))
  );
  res.json({ devices: out });
});

router.get("/:deviceId/summary", async (req, res) => {
  const { deviceId } = req.params;
  const day = new Date().toISOString().slice(0, 10);
  const [device, lastLoc, topApps, recentNotifs, contactsCount, recentCalls] = await Promise.all([
    Device.findOne({ deviceId }).lean(),
    Location.findOne({ deviceId }).sort({ recordedAt: -1 }).lean(),
    AppUsage.find({ deviceId, day }).sort({ totalTimeMs: -1 }).limit(8).lean(),
    NotificationLog.find({ deviceId }).sort({ postedAt: -1 }).limit(10).lean(),
    Contact.countDocuments({ deviceId }),
    CallLog.find({ deviceId }).sort({ timestamp: -1 }).limit(10).lean(),
  ]);
  res.json({ device, lastLocation: lastLoc, topApps, recentNotifs, contactsCount, recentCalls, day });
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

// GET /:deviceId/notifications?page=1&pageSize=50&package=...&search=...
// Paginated so the feed isn't capped at a fixed row count — `search` matches
// across the WHOLE device history (not just the current page), and `stats`
// always summarizes the whole history too (independent of package/search),
// so the stat strip stays meaningful no matter what page or filter is active.
router.get("/:deviceId/notifications", async (req, res) => {
  const { deviceId } = req.params;
  const { page, pageSize } = pageParams(req);

  const q = { deviceId };
  if (req.query.package) q.packageName = req.query.package;
  if (req.query.search) {
    const re = new RegExp(escapeRegex(req.query.search), "i");
    q.$or = [{ title: re }, { text: re }, { appLabel: re }, { packageName: re }];
  }

  const dayAgo = new Date(Date.now() - 86400000);
  const [items, matchedTotal, deviceTotal, last24h, byApp] = await Promise.all([
    NotificationLog.find(q).sort({ postedAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    NotificationLog.countDocuments(q),
    NotificationLog.countDocuments({ deviceId }),
    NotificationLog.countDocuments({ deviceId, postedAt: { $gte: dayAgo } }),
    NotificationLog.aggregate([
      { $match: { deviceId } },
      { $group: { _id: { $ifNull: ["$appLabel", "$packageName"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({
    items,
    total: matchedTotal,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(matchedTotal / pageSize)),
    stats: {
      total: deviceTotal,
      last24h,
      apps: byApp.length,
      busiest: byApp[0] ? { name: byApp[0]._id, count: byApp[0].count } : null,
    },
  });
});

// Distinct (packageName, appLabel) pairs across the WHOLE device history, for
// the "All apps" filter dropdown — unaffected by the current search/page.
router.get("/:deviceId/notifications/apps", async (req, res) => {
  const { deviceId } = req.params;
  const apps = await NotificationLog.aggregate([
    { $match: { deviceId } },
    { $group: { _id: "$packageName", appLabel: { $first: "$appLabel" } } },
    { $sort: { _id: 1 } },
  ]);
  res.json({ apps: apps.map((a) => ({ packageName: a._id, appLabel: a.appLabel })) });
});

router.get("/:deviceId/contacts", async (req, res) => {
  const { deviceId } = req.params;
  const items = await Contact.find({ deviceId }).sort({ name: 1 }).lean();
  res.json({ items });
});

// GET /:deviceId/calllogs?page=1&pageSize=50&type=...&search=...
// Same shape as /notifications above: `search` (name/number) matches across
// the whole history, `stats` always summarizes the whole history.
router.get("/:deviceId/calllogs", async (req, res) => {
  const { deviceId } = req.params;
  const { page, pageSize } = pageParams(req);

  const q = { deviceId };
  if (req.query.type) q.type = req.query.type;
  if (req.query.search) {
    const re = new RegExp(escapeRegex(req.query.search), "i");
    q.$or = [{ name: re }, { number: re }];
  }

  const [items, matchedTotal, deviceTotal, missed, talk, byContact] = await Promise.all([
    CallLog.find(q).sort({ timestamp: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean(),
    CallLog.countDocuments(q),
    CallLog.countDocuments({ deviceId }),
    CallLog.countDocuments({ deviceId, type: "missed" }),
    CallLog.aggregate([
      { $match: { deviceId, type: { $in: ["incoming", "outgoing"] } } },
      { $group: { _id: null, total: { $sum: "$durationSec" } } },
    ]),
    CallLog.aggregate([
      { $match: { deviceId } },
      { $group: { _id: { $ifNull: ["$name", "$number"] }, count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);

  res.json({
    items,
    total: matchedTotal,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(matchedTotal / pageSize)),
    stats: {
      total: deviceTotal,
      missed,
      talkTimeSec: talk[0]?.total || 0,
      mostFrequent: byContact[0] ? { name: byContact[0]._id, count: byContact[0].count } : null,
    },
  });
});

export default router;
