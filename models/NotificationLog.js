import mongoose from "mongoose";

const NotificationSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    // Stable-ish key so re-sends de-duplicate instead of piling up.
    key: { type: String, required: true },
    packageName: String,
    appLabel: String,
    title: String,
    text: String,
    category: String,
    postedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

NotificationSchema.index({ deviceId: 1, key: 1 }, { unique: true });
NotificationSchema.index({ deviceId: 1, postedAt: -1 });

export default mongoose.model("NotificationLog", NotificationSchema);
