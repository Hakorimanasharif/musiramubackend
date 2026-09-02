import mongoose from "mongoose";

const logSchema = new mongoose.Schema({
  type: { type: String, enum: ["payment","loan","customer"], required: true },
  customerName: { type: String, required: true },
  amount: { type: Number, default: 0 },
  loanId: { type: String },
  loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan" },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer" },
}, { timestamps: true });

export default mongoose.model("Log", logSchema);
