import mongoose from "mongoose";

const DeviceSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, unique: true, index: true },
    label: { type: String, default: "My phone" },
    model: String,
    androidVersion: String,
    // Hashed device token. The raw token lives only on the phone.
    tokenHash: { type: String, required: true },
    consentAcceptedAt: Date,
    lastSeenAt: Date,
    battery: Number,
  },
  { timestamps: true }
);

export default mongoose.model("Device", DeviceSchema);
