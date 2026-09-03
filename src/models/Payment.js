import mongoose from "mongoose";

const paymentSchema = new mongoose.Schema({
  loan: { type: mongoose.Schema.Types.ObjectId, ref: "Loan", required: true, index: true },
  loanId: { type: String, required: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true, index: true },
  amount: { type: Number, required: true, min: 1 },
  remainingAfter: { type: Number, required: true },
  principalBefore: { type: Number, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { timestamps: true });

paymentSchema.index({ loan: 1, createdAt: -1 });
paymentSchema.index({ customer: 1, createdAt: -1 });

export default mongoose.model("Payment", paymentSchema);
