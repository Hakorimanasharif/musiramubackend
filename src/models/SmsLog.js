import mongoose from "mongoose";

const smsLogSchema = new mongoose.Schema({
  to: { type: String, required: true },
  message: { type: String, required: true },
  provider: { type: String, enum: ["smsconnect","esms","simulated"], default: "simulated" },
  status: { type: String, enum: ["sent","failed","simulated"], default: "simulated" },
  cost: { type: Number, default: 0 },
  balance: { type: String },
  providerMessageId: { type: String },
  loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
  type: { type: String, enum: ["loan","payment","overdue","add_items","customer","otp","reminder"], default: "loan" },
  error: { type: String },
  raw: { type: mongoose.Schema.Types.Mixed },
  read: { type: Boolean, default: false },
  readAt: { type: Date },
}, { timestamps: true });

smsLogSchema.index({ to: 1, createdAt: -1 });
smsLogSchema.index({ type: 1 });

export default mongoose.model("SmsLog", smsLogSchema);
