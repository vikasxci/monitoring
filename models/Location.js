import mongoose from "mongoose";

const LocationSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    accuracy: Number,
    altitude: Number,
    speed: Number,
    recordedAt: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

LocationSchema.index({ deviceId: 1, recordedAt: -1 });

export default mongoose.model("Location", LocationSchema);
