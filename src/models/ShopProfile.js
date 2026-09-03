import mongoose from "mongoose";

const shopProfileSchema = new mongoose.Schema({
  shopName: { type: String, default: "MusiRamu General Shop" },
  currency: { type: String, default: "RWF" },
  phone: { type: String, default: "+250 788 123 456" },
  email: { type: String, default: "info@musiramu.rw" },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: "User", unique: true },
  notifications: {
    smsOnLoan: { type: Boolean, default: true },
    smsOnPayment: { type: Boolean, default: true },
    smsOnOverdue: { type: Boolean, default: true },
    smsOnCustomer: { type: Boolean, default: true },
    smsOnAddItems: { type: Boolean, default: true },
    emailOnLoan: { type: Boolean, default: true },
  },
}, { timestamps: true });

export default mongoose.model("ShopProfile", shopProfileSchema);
