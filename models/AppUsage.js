import mongoose from "mongoose";

// One document per app per sync window (daily buckets are convenient for a dashboard).
const AppUsageSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    day: { type: String, required: true }, // YYYY-MM-DD (device local)
    packageName: { type: String, required: true },
    appLabel: String,
    totalTimeMs: { type: Number, default: 0 },
    lastUsedAt: Date,
    launchCount: Number,
  },
  { timestamps: true }
);

AppUsageSchema.index({ deviceId: 1, day: 1, packageName: 1 }, { unique: true });

export default mongoose.model("AppUsage", AppUsageSchema);
