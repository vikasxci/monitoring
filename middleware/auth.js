import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import Device from "../models/Device.js";

// --- Admin (dashboard) auth: JWT in Authorization: Bearer <token> ---
export function requireAdmin(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "missing token" });
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    if (payload.role !== "admin") throw new Error("not admin");
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

// --- Device auth: X-Device-Id + X-Device-Token headers ---
export async function requireDevice(req, res, next) {
  const deviceId = req.headers["x-device-id"];
  const token = req.headers["x-device-token"];
  if (!deviceId || !token) {
    console.warn(`[auth] device request rejected: missing credentials (path=${req.path})`);
    return res.status(401).json({ error: "missing device credentials" });
  }
  const device = await Device.findOne({ deviceId });
  if (!device) {
    console.warn(`[auth] device request rejected: unknown device=${deviceId} (path=${req.path})`);
    return res.status(401).json({ error: "unknown device" });
  }

  const ok = await bcrypt.compare(token, device.tokenHash);
  if (!ok) {
    console.warn(`[auth] device request rejected: bad token for device=${deviceId} (path=${req.path})`);
    return res.status(401).json({ error: "bad device token" });
  }

  device.lastSeenAt = new Date();
  if (req.headers["x-battery"]) device.battery = Number(req.headers["x-battery"]);
  await device.save();

  req.device = device;
  next();
}
