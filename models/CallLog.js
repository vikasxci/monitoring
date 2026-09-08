import mongoose from "mongoose";

const CallLogSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    // Device-local CallLog.Calls._ID — stable per call, used to dedupe re-sends.
    callId: { type: String, required: true },
    number: String,
    name: String, // cached contact name, if the phone resolved one
    type: { type: String, default: "unknown" }, // incoming | outgoing | missed | rejected | blocked | voicemail | unknown
    durationSec: { type: Number, default: 0 },
    timestamp: { type: Date, required: true, index: true },
  },
  { timestamps: true }
);

CallLogSchema.index({ deviceId: 1, callId: 1 }, { unique: true });
CallLogSchema.index({ deviceId: 1, timestamp: -1 });

export default mongoose.model("CallLog", CallLogSchema);
