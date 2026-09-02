import Customer from "../models/Customer.js";
import Loan from "../models/Loan.js";
import Log from "../models/Log.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

export const getCustomers = async (req, res) => {
  const { search = "", page = 1, limit = 20 } = req.query;
  const q = search ? {
    $or: [
      { firstName: { $regex: search, $options: "i" } },
      { lastName: { $regex: search, $options: "i" } },
      { phone: { $regex: search, $options: "i" } },
      { email: { $regex: search, $options: "i" } },
    ]
  } : {};
  const total = await Customer.countDocuments(q);
  const customers = await Customer.find(q).sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit));
  // attach outstanding & active loans
  const withStats = await Promise.all(customers.map(async c=>{
    const loans = await Loan.find({ customer: c._id });
    const active = loans.filter(l=>l.remaining>0).length;
    const outstanding = loans.reduce((a,l)=>a+l.remaining,0);
    return { ...c.toObject(), activeLoans: active, totalOutstanding: outstanding, totalLoans: loans.length };
  }));
  res.json({ customers: withStats, total, page: Number(page), pages: Math.ceil(total/limit) });
};

export const getCustomerById = async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if(!customer) return res.status(404).json({message:"Customer not found"});
  const loans = await Loan.find({ customer: customer._id }).sort({ createdAt: -1 });
  res.json({ customer, loans });
};

export const createCustomer = async (req, res) => {
  const { firstName, lastName, phone, email } = req.body;
  if(!firstName || !lastName || !phone) return res.status(400).json({message:"First name, last name and phone required"});
  const phoneDigits = phone.replace(/\D/g,"");
  const emailNorm = email ? String(email).toLowerCase().trim() : "";
  if(!/^\d{10}$/.test(phoneDigits)) return res.status(400).json({message:"Phone must be 10 digits"});
  if(emailNorm && !/^\S+@\S+\.\S+$/.test(emailNorm)) return res.status(400).json({message:"Invalid email"});
  // names may be same — only phone must be unique, email unique if provided
  const phoneExists = await Customer.findOne({ phone: phoneDigits });
  if(phoneExists) return res.status(400).json({message:"Phone number already exists"});
  if(emailNorm){
    const emailExists = await Customer.findOne({ email: emailNorm });
    if(emailExists) return res.status(400).json({message:"Email already exists"});
  }
  try {
    const payload = { firstName: firstName.trim(), lastName: lastName.trim(), phone: phoneDigits, createdBy: req.user._id };
    if(emailNorm) payload.email = emailNorm;
    const customer = await Customer.create(payload);
    await Log.create({ type:"customer", customerName:`${firstName} ${lastName}`, amount:0, loanId:"NEW", customer: customer._id });
    notifyShopOwner({ type:"customer", customerName:`${firstName} ${lastName}`, amount:0, loanId:"NEW", customerId: customer._id, ownerId: req.user._id, details: `Phone: ${phoneDigits}${emailNorm?` Email: ${emailNorm}`:""}` });
    res.status(201).json(customer);
  } catch (e) {
    if(e.code === 11000){
      const field = e.keyPattern?.phone ? "Phone number already exists" : e.keyPattern?.email ? "Email already exists" : "Duplicate phone or email";
      return res.status(400).json({message: field});
    }
    throw e;
  }
};

export const deleteCustomer = async (req, res) => {
  const customerId = req.params.id;
  const customer = await Customer.findById(customerId);
  if (!customer) return res.status(404).json({message:"Customer not found"});
  const activeLoan = await Loan.exists({ customer: customerId, remaining: { $gt: 0 } });
  if (activeLoan) return res.status(400).json({message:"Cannot delete customer with active loans (remaining > 0). Settle loans first."});
  await Customer.findByIdAndDelete(customerId);
  // optionally keep loans for history but now orphan - we keep them for audit
  res.json({message:"Deleted"});
};
