import mongoose from "mongoose";

const ContactSchema = new mongoose.Schema(
  {
    deviceId: { type: String, required: true, index: true },
    contactId: { type: String, required: true }, // device-local id
    name: String,
    phones: [String],
    emails: [String],
  },
  { timestamps: true }
);

ContactSchema.index({ deviceId: 1, contactId: 1 }, { unique: true });

export default mongoose.model("Contact", ContactSchema);
