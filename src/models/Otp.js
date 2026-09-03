import mongoose from "mongoose";

const otpSchema = new mongoose.Schema({
  identifier: { type: String, required: true, index: true }, // phone or email
  otp: { type: String, required: true },
  purpose: { type: String, default: "reset" },
  expiresAt: { type: Date, default: () => new Date(Date.now() + 5*60*1000), index: { expires: 300 } },
}, { timestamps: true });

otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model("Otp", otpSchema);
