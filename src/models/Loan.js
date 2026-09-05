import mongoose from "mongoose";

const lineItemSchema = new mongoose.Schema({
  name: { type: String, required: true },
  qty: { type: Number, required: true, min: 1 },
  price: { type: Number, required: true, min: 0 },
}, { _id: false });

const historyEntrySchema = new mongoose.Schema({
  type: { type: String, enum: ["created", "add_items", "due_date_update"], required: true },
  date: { type: Date, default: Date.now },
  lineItems: { type: [lineItemSchema], default: [] },
  addedAmount: { type: Number, default: 0 },
  previousPrincipal: { type: Number },
  newPrincipal: { type: Number },
  previousDueDate: { type: Date },
  newDueDate: { type: Date },
  note: { type: String },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
}, { _id: true });

const loanSchema = new mongoose.Schema({
  loanId: { type: String, unique: true, required: true }, // L-1001
  customer: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
  items: { type: String, required: true }, // joined string for display
  lineItems: { type: [lineItemSchema], default: [] },
  principal: { type: Number, required: true, min: 0 },
  remaining: { type: Number, required: true, min: 0 },
  status: { type: String, enum: ["Pending","Overdue","Paid"], default: "Pending" },
  dueDate: { type: Date, required: true },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  lastOverdueNotifiedAt: { type: Date },
  lastReminderAt: { type: Date },
  history: { type: [historyEntrySchema], default: [] },
}, { timestamps: true });

loanSchema.pre("save", function(next){
  if(this.remaining === 0) this.status = "Paid";
  else if(this.dueDate < new Date() && this.status !== "Paid") {
    // keep Overdue if already overdue, or set to Overdue if past due and not Paid
    if(this.status === "Pending" && this.dueDate < new Date()) this.status = "Overdue";
  }
  next();
});

export default mongoose.model("Loan", loanSchema);
