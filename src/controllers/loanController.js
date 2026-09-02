import Loan from "../models/Loan.js";
import Customer from "../models/Customer.js";
import Log from "../models/Log.js";
import Counter from "../models/Counter.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

const generateLoanId = async () => {
  const counter = await Counter.findOneAndUpdate(
    { _id: "loanId" },
    { $inc: { seq: 1 } },
    { upsert: true, new: true }
  );
  // first call gives 1001, second 1002, etc.
  return `L-${counter.seq}`;
};

export const getLoans = async (req, res) => {
  const { status, search = "", page = 1, limit = 6 } = req.query;
  let q = {};
  if (status && status !== "All") q.status = status;
  // search by loanId or items
  if (search) {
    q.$or = [
      { loanId: { $regex: search, $options: "i" } },
      { items: { $regex: search, $options: "i" } },
    ];
  }
  // if search also matches customer name, we need to find customers
  let customerIds = [];
  if (search) {
    const customers = await Customer.find({
      $or: [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
      ]
    }).select("_id");
    if (customers.length) {
      const ids = customers.map(c=>c._id);
      if (q.$or) q.$or.push({ customer: { $in: ids } });
      else q.customer = { $in: ids };
      // need to handle $or with mixed fields - mongoose handles
      // For simplicity, if we added $or, keep it; otherwise use customer filter
    }
  }
  const total = await Loan.countDocuments(q);
  const loans = await Loan.find(q).populate("customer").sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit));
  res.json({ loans, total, page: Number(page), pages: Math.ceil(total/limit) });
};

export const createLoan = async (req, res) => {
  const { customerId, customer, dueDate, lineItems } = req.body;
  const custId = customerId || customer;
  if (!custId || !dueDate || !lineItems || !lineItems.length) return res.status(400).json({message:"Customer, dueDate and lineItems required"});
  const cust = await Customer.findById(custId);
  if (!cust) return res.status(404).json({message:"Customer not found"});
  // calculate principal
  const valid = lineItems.filter(it=> it.name && it.name.trim() && Number(it.qty)>0 && Number(it.price)>0);
  if (!valid.length) return res.status(400).json({message:"No valid line items"});
  const principal = valid.reduce((a,it)=> a + Number(it.qty)*Number(it.price), 0);
  const itemsStr = valid.map(it=> `${it.qty}x ${it.name.trim()} @${it.price}`).join(", ");
  const loanId = await generateLoanId();
  const due = new Date(dueDate);
  const status = due < new Date() ? "Overdue" : "Pending";
  const loan = await Loan.create({
    loanId,
    customer: cust._id,
    items: itemsStr,
    lineItems: valid.map(it=>({ name: it.name.trim(), qty: Number(it.qty), price: Number(it.price) })),
    principal,
    remaining: principal,
    status,
    dueDate: due,
    createdBy: req.user._id,
  });
  await Log.create({ type:"loan", customerName:`${cust.firstName} ${cust.lastName}`, amount: principal, loanId, loan: loan._id, customer: cust._id });
  notifyShopOwner({ type:"loan", customerName:`${cust.firstName} ${cust.lastName}`, amount: principal, loanId, loanDbId: loan._id, customerId: cust._id, ownerId: req.user._id, details: `Items: ${itemsStr} Due: ${due.toISOString().slice(0,10)}` });
  const populated = await loan.populate("customer");
  res.status(201).json(populated);
};

export const collectPayment = async (req, res) => {
  const { amount } = req.body;
  const loan = await Loan.findById(req.params.id).populate("customer");
  if (!loan) return res.status(404).json({message:"Loan not found"});
  const amt = Number(amount);
  if (!amt || amt <=0) return res.status(400).json({message:"Invalid amount"});
  if (amt > loan.remaining) return res.status(400).json({message:"Amount exceeds remaining balance"});
  loan.remaining -= amt;
  if (loan.remaining === 0) loan.status = "Paid";
  await loan.save();
  await Log.create({ type:"payment", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: amt, loanId: loan.loanId, loan: loan._id, customer: loan.customer._id });
  notifyShopOwner({ type:"payment", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: amt, loanId: loan.loanId, loanDbId: loan._id, customerId: loan.customer._id, ownerId: req.user._id, details: `Paid ${amt} RWF Remaining: ${loan.remaining} RWF` });
  res.json(loan);
};

export const getLoanById = async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate("customer");
  if (!loan) return res.status(404).json({message:"Not found"});
  res.json(loan);
};

export const getLoanReceipt = async (req, res) => {
  const { loanId } = req.params;
  const loan = await Loan.findOne({ loanId }).populate("customer");
  if (!loan) return res.status(404).json({message:"Receipt not found"});
  const ShopProfile = (await import("../models/ShopProfile.js")).default;
  const shop = await ShopProfile.findOne();
  res.json({ loan, shop, customer: loan.customer });
};

export const addItemsToLoan = async (req, res) => {
  const { lineItems, dueDate } = req.body;
  const loan = await Loan.findById(req.params.id).populate("customer");
  if (!loan) return res.status(404).json({message:"Loan not found"});
  if (loan.status === "Paid") return res.status(400).json({message:"Cannot add items to a paid loan"});
  const valid = (lineItems||[]).filter(it=> it.name && it.name.trim() && Number(it.qty)>0 && Number(it.price)>0);
  if (!valid.length && !dueDate) return res.status(400).json({message:"Provide lineItems to add or new dueDate"});
  let added = 0;
  if(valid.length){
    added = valid.reduce((a,it)=> a + Number(it.qty)*Number(it.price), 0);
    const newLineItems = valid.map(it=>({ name: it.name.trim(), qty: Number(it.qty), price: Number(it.price) }));
    loan.lineItems.push(...newLineItems);
    const addedStr = newLineItems.map(it=> `${it.qty}x ${it.name} @${it.price}`).join(", ");
    loan.items = loan.items ? `${loan.items}, ${addedStr}` : addedStr;
    loan.principal += added;
    loan.remaining += added;
  }
  if(dueDate){
    const newDue = new Date(dueDate);
    if(isNaN(newDue)) return res.status(400).json({message:"Invalid dueDate"});
    loan.dueDate = newDue;
  }
  // update status based on new dueDate and remaining
  if(loan.remaining === 0) loan.status = "Paid";
  else if(loan.dueDate < new Date()) loan.status = "Overdue";
  else loan.status = "Pending";
  await loan.save();
  if(added>0){
    await Log.create({ type:"loan", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: added, loanId: loan.loanId, loan: loan._id, customer: loan.customer._id });
    notifyShopOwner({ type:"add_items", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: added, loanId: loan.loanId, loanDbId: loan._id, customerId: loan.customer._id, ownerId: req.user._id, details: `Added ${added} RWF New total: ${loan.principal} RWF New due: ${loan.dueDate.toISOString().slice(0,10)}` });
  } else if(dueDate){
    notifyShopOwner({ type:"overdue", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: loan.remaining, loanId: loan.loanId, loanDbId: loan._id, customerId: loan.customer._id, ownerId: req.user._id, details: `Due date extended to ${loan.dueDate.toISOString().slice(0,10)} Remaining: ${loan.remaining} RWF` });
  }
  const populated = await loan.populate("customer");
  res.json({ loan: populated, added, newDueDate: loan.dueDate, newTotal: loan.principal, remaining: loan.remaining });
};
