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

export const getCustomerStatementPdf = async (req, res) => {
  const customer = await Customer.findById(req.params.id);
  if (!customer) return res.status(404).json({ message: "Customer not found" });
  const loans = await Loan.find({ customer: customer._id }).sort({ createdAt: 1 });
  const Payment = (await import("../models/Payment.js")).default;
  const payments = await Payment.find({ customer: customer._id }).sort({ createdAt: 1 });
  const ShopProfile = (await import("../models/ShopProfile.js")).default;
  const shop = await ShopProfile.findOne() || { shopName: "MusiRamu General Shop", email: "info@musiramu.rw", phone: "+250 788 123 456", currency: "RWF" };
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="Statement-${customer.firstName}-${customer.lastName}.pdf"`);
  doc.pipe(res);
  doc.fillColor("#4f46e5").rect(0,0,600,80).fill();
  doc.fillColor("white").fontSize(16).font("Helvetica-Bold").text(shop.shopName, 40, 25);
  doc.fontSize(8).font("Helvetica").text(`${shop.email} • ${shop.phone}`, 40, 45);
  doc.fontSize(10).text(`Statement: ${customer.firstName} ${customer.lastName}`, 400, 25, { align: "right" });
  doc.fontSize(8).text(`${customer.phone} • ${customer.email||""}`, 400, 40, { align: "right" });
  // Summary
  const totalOutstanding = loans.reduce((a,l)=>a+l.remaining,0);
  const totalPrincipal = loans.reduce((a,l)=>a+l.principal,0);
  const totalPaid = totalPrincipal - totalOutstanding;
  doc.fillColor("black").fontSize(10).font("Helvetica-Bold").text("Summary", 40, 95);
  doc.fontSize(9).font("Helvetica").text(`Total Loans: ${loans.length}  Principal: ${new Intl.NumberFormat("en-RW").format(totalPrincipal)} ${shop.currency}  Paid: ${new Intl.NumberFormat("en-RW").format(totalPaid)}  Outstanding: ${new Intl.NumberFormat("en-RW").format(totalOutstanding)}`, 40, 110);
  let y = 135;
  doc.fontSize(9).font("Helvetica-Bold").text("Loans", 40, y); y+=12;
  if (loans.length===0) doc.fontSize(8).font("Helvetica").text("No loans", 40, y);
  else {
    loans.forEach(l=>{
      if (y>700) { doc.addPage(); y=40; }
      doc.fontSize(8).font("Helvetica").text(`${l.loanId} • ${l.status} • Due ${new Date(l.dueDate).toISOString().slice(0,10)} • Principal ${new Intl.NumberFormat("en-RW").format(l.principal)} • Remaining ${new Intl.NumberFormat("en-RW").format(l.remaining)}`, 40, y, { width: 515 });
      doc.fontSize(7).fillColor("#64748b").text(l.items.slice(0,80), 40, y+10, { width: 515 });
      doc.fillColor("black"); y+=22;
    });
  }
  y+=10;
  doc.fontSize(9).font("Helvetica-Bold").text("Payment History", 40, y); y+=12;
  if (payments.length===0) doc.fontSize(8).font("Helvetica").text("No payments yet", 40, y);
  else {
    payments.forEach(p=>{
      if (y>700) { doc.addPage(); y=40; }
      doc.fontSize(8).font("Helvetica").text(`${new Date(p.createdAt).toISOString().slice(0,10)} • ${p.loanId} • Paid ${new Intl.NumberFormat("en-RW").format(p.amount)} • Remaining after: ${new Intl.NumberFormat("en-RW").format(p.remainingAfter)}`, 40, y, { width: 515 });
      y+=12;
    });
  }
  doc.end();
};

export const exportCustomersCsv = async (req, res) => {
  const customers = await Customer.find().sort({ createdAt: -1 });
  const header = "firstName,lastName,phone,email,createdAt\n";
  const rows = customers.map(c=> `${c.firstName},${c.lastName},${c.phone},${c.email||""},${c.createdAt.toISOString().slice(0,10)}`).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=customers.csv");
  res.send(header + rows);
};

export const importCustomersCsv = async (req, res) => {
  const { csv } = req.body; // expects csv string or array
  if (!csv) return res.status(400).json({ message: "csv required" });
  const lines = String(csv).split("\n").filter(l=>l.trim() && !l.toLowerCase().startsWith("firstname"));
  let imported = 0, errors = [];
  for (const line of lines) {
    const [firstName,lastName,phone,email] = line.split(",").map(s=>s?.trim());
    if (!firstName || !lastName || !phone) { errors.push(line); continue; }
    const phoneDigits = phone.replace(/\D/g,"");
    if (!/^\d{10}$/.test(phoneDigits)) { errors.push(line); continue; }
    try {
      const exists = await Customer.findOne({ phone: phoneDigits });
      if (exists) { errors.push(line+" - phone exists"); continue; }
      await Customer.create({ firstName, lastName, phone: phoneDigits, email: email||undefined, createdBy: req.user?._id });
      imported++;
    } catch(e){ errors.push(line+" - "+e.message); }
  }
  res.json({ imported, errors, total: lines.length });
};
