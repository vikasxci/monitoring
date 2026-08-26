import { Router } from "express";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import Device from "../models/Device.js";

const router = Router();

// --- Admin login for the dashboard ---
router.post("/admin/login", (req, res) => {
  const { username, password } = req.body || {};
  if (
    username === process.env.ADMIN_USERNAME &&
    password === process.env.ADMIN_PASSWORD
  ) {
    const token = jwt.sign({ role: "admin", username }, process.env.JWT_SECRET, {
      expiresIn: "12h",
    });
    return res.json({ token });
  }
  return res.status(401).json({ error: "bad credentials" });
});

// --- Device enrollment ---
// The phone presents the shared enrollment code once. We mint a random device
// token, store only its hash, and return the raw token to the phone (once).
router.post("/devices/enroll", async (req, res) => {
  const { enrollmentCode, deviceId, label, model, androidVersion, consent } =
    req.body || {};

  if (enrollmentCode !== process.env.DEVICE_ENROLLMENT_CODE) {
    return res.status(401).json({ error: "bad enrollment code" });
  }
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  if (!consent) {
    return res
      .status(400)
      .json({ error: "consent must be accepted on the device to enroll" });
  }

  const rawToken = crypto.randomBytes(32).toString("hex");
  const tokenHash = await bcrypt.hash(rawToken, 10);

  await Device.findOneAndUpdate(
    { deviceId },
    {
      deviceId,
      label: label || "My phone",
      model,
      androidVersion,
      tokenHash,
      consentAcceptedAt: new Date(),
      lastSeenAt: new Date(),
    },
    { upsert: true, new: true }
  );

  return res.json({ deviceId, deviceToken: rawToken });
});

export default router;
