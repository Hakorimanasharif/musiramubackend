import Loan from "../models/Loan.js";
import Customer from "../models/Customer.js";
import Log from "../models/Log.js";
import Counter from "../models/Counter.js";
import Payment from "../models/Payment.js";
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
  const { status, search = "", page = 1, limit = 6, from, to } = req.query;
  let q = {};
  if (status && status !== "All") q.status = status;
  if (from || to) {
    q.createdAt = {};
    if (from) q.createdAt.$gte = new Date(from);
    if (to) q.createdAt.$lte = new Date(to);
  }
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
  // Enforce single active loan per customer: cannot create new loan if active exists
  const activeLoan = await Loan.findOne({ customer: cust._id, remaining: { $gt: 0 }, status: { $in: ["Pending","Overdue"] } });
  if (activeLoan) {
    return res.status(400).json({
      message: `Customer already has an active loan ${activeLoan.loanId} (${activeLoan.status}, ${activeLoan.remaining} RWF remaining). Add products to existing loan instead.`,
      activeLoanId: activeLoan.loanId,
      activeLoanDbId: activeLoan._id,
      activeLoanStatus: activeLoan.status,
      activeLoanRemaining: activeLoan.remaining,
      code: "ACTIVE_LOAN_EXISTS"
    });
  }
  // calculate principal
  const valid = lineItems.filter(it=> it.name && it.name.trim() && Number(it.qty)>0 && Number(it.price)>0);
  if (!valid.length) return res.status(400).json({message:"No valid line items"});
  const principal = valid.reduce((a,it)=> a + Number(it.qty)*Number(it.price), 0);
  const itemsStr = valid.map(it=> `${it.qty}× ${it.name.trim()} — ${Number(it.price).toLocaleString()} RWF`).join(", ");
  const loanId = await generateLoanId();
  const due = new Date(dueDate);
  const status = due < new Date() ? "Overdue" : "Pending";
  const mappedItems = valid.map(it=>({ name: it.name.trim(), qty: Number(it.qty), price: Number(it.price) }));
  const loan = await Loan.create({
    loanId,
    customer: cust._id,
    items: itemsStr,
    lineItems: mappedItems,
    principal,
    remaining: principal,
    status,
    dueDate: due,
    createdBy: req.user._id,
    history: [{
      type: "created",
      date: new Date(),
      lineItems: mappedItems,
      addedAmount: principal,
      previousPrincipal: 0,
      newPrincipal: principal,
      previousDueDate: null,
      newDueDate: due,
      note: `Loan created with ${mappedItems.length} items`,
      createdBy: req.user._id,
    }]
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
  const principalBefore = loan.principal;
  loan.remaining -= amt;
  if (loan.remaining === 0) loan.status = "Paid";
  await loan.save();
  const payment = await Payment.create({ loan: loan._id, loanId: loan.loanId, customer: loan.customer._id, amount: amt, remainingAfter: loan.remaining, principalBefore, createdBy: req.user._id });
  await Log.create({ type:"payment", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: amt, loanId: loan.loanId, loan: loan._id, customer: loan.customer._id });
  notifyShopOwner({ type:"payment", customerName:`${loan.customer.firstName} ${loan.customer.lastName}`, amount: amt, loanId: loan.loanId, loanDbId: loan._id, customerId: loan.customer._id, ownerId: req.user._id, details: `Paid ${amt} RWF Remaining: ${loan.remaining} RWF` });
  res.json({ loan, payment });
};

export const getPaymentHistory = async (req, res) => {
  const { id } = req.params;
  const payments = await Payment.find({ loan: id }).sort({ createdAt: -1 }).populate("customer", "firstName lastName phone");
  res.json(payments);
};

export const getCustomerPayments = async (req, res) => {
  const { id } = req.params; // customer id
  const payments = await Payment.find({ customer: id }).sort({ createdAt: -1 }).populate("loan", "loanId");
  res.json(payments);
};

export const getLoanHistory = async (req, res) => {
  const { id } = req.params;
  const loan = await Loan.findById(id).populate("customer");
  if (!loan) return res.status(404).json({message:"Loan not found"});
  const payments = await Payment.find({ loan: id }).sort({ createdAt: -1 });
  // combine history + payments chronologically for timeline
  res.json({ loan, history: loan.history || [], payments });
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

export const getLoanReceiptPdf = async (req, res) => {
  const { loanId } = req.params;
  const loan = await Loan.findOne({ loanId }).populate("customer");
  if (!loan) return res.status(404).json({message:"Receipt not found"});
  const ShopProfile = (await import("../models/ShopProfile.js")).default;
  const shop = await ShopProfile.findOne() || { shopName: "IHAHIRO NYARYO(musiramu)", email: "hakorimanasharif12@gmail.com", phone: "0788609341", currency: "RWF" };
  const formatCurrency = (n) => new Intl.NumberFormat("en-RW").format(n) + " " + (shop.currency || "RWF");

  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", margin: 40 });

  const disType = req.query.download === "1" ? "attachment" : "inline";
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `${disType}; filename="Receipt-${loan.loanId}.pdf"`);
  res.setHeader("Access-Control-Allow-Origin", "*");
  doc.pipe(res);

  // Header
  doc.fillColor("#4f46e5").rect(0,0,600,90).fill();
  doc.fillColor("white").fontSize(20).font("Helvetica-Bold").text(shop.shopName, 40, 30);
  doc.fontSize(9).font("Helvetica").text(`${shop.email} • ${shop.phone} • ${shop.currency}`, 40, 55);
  doc.fontSize(10).text(`Receipt: ${loan.loanId}`, 400, 30, { align: "right" });
  doc.fontSize(8).text(`Date: ${new Date(loan.createdAt).toISOString().slice(0,10)}  Due: ${new Date(loan.dueDate).toISOString().slice(0,10)}`, 400, 45, { align: "right" });
  const statusColor = loan.status === "Paid" ? "#10b981" : loan.status === "Overdue" ? "#ef4444" : "#f59e0b";
  doc.fillColor(statusColor).fontSize(9).font("Helvetica-Bold").text(loan.status.toUpperCase(), 400, 62, { align: "right" });

  doc.fillColor("black");
  let y = 110;
  // Customer
  doc.fontSize(11).font("Helvetica-Bold").text("Customer", 40, y);
  doc.fontSize(10).font("Helvetica").text(`${loan.customer.firstName} ${loan.customer.lastName}`, 40, y+15);
  doc.fontSize(8).fillColor("#64748b").text(`${loan.customer.phone}  •  ${loan.customer.email || ""}`, 40, y+28);
  doc.fillColor("black");
  // Loan
  doc.fontSize(11).font("Helvetica-Bold").text("Loan", 350, y);
  doc.fontSize(9).font("Helvetica").text(`ID: ${loan.loanId}`, 350, y+15);
  doc.text(`Created: ${new Date(loan.createdAt).toISOString().slice(0,10)}`, 350, y+28);

  y = 160;
  doc.moveTo(40, y).lineTo(555, y).strokeColor("#e2e8f0").stroke();
  y += 12;
  doc.fontSize(10).font("Helvetica-Bold").fillColor("#1e293b").text("Items (no mistake) - All line items:", 40, y);
  y += 18;
  // Table header
  doc.fillColor("white").rect(40, y, 515, 18).fillColor("#475569").fill();
  doc.fillColor("white").fontSize(8).font("Helvetica-Bold");
  doc.text("#", 45, y+6);
  doc.text("Item", 65, y+6);
  doc.text("Qty", 350, y+6, { width: 40, align: "center" });
  doc.text("Price", 400, y+6, { width: 70, align: "right" });
  doc.text("Total", 485, y+6, { width: 65, align: "right" });
  y += 18;
  doc.fillColor("black").font("Helvetica").fontSize(8);
  loan.lineItems.forEach((it, idx) => {
    if (y > 720) { doc.addPage(); y = 40; }
    const total = Number(it.qty) * Number(it.price);
    doc.text(String(idx+1), 45, y+6);
    doc.text(it.name, 65, y+6, { width: 270 });
    doc.text(String(it.qty), 350, y+6, { width: 40, align: "center" });
    doc.text(formatCurrency(it.price), 400, y+6, { width: 70, align: "right" });
    doc.text(formatCurrency(total), 485, y+6, { width: 65, align: "right" });
    doc.moveTo(40, y+16).lineTo(555, y+16).strokeColor("#f1f5f9").stroke();
    y += 16;
  });
  y += 10;
  // Totals
  const paid = loan.principal - loan.remaining;
  const percent = Math.round((paid / (loan.principal || 1)) * 100);
  doc.font("Helvetica-Bold").fontSize(9);
  doc.text("Principal:", 400, y, { width: 70, align: "right" }); doc.text(formatCurrency(loan.principal), 485, y, { width: 65, align: "right" }); y+=12;
  doc.fillColor("#10b981").text("Paid:", 400, y, { width: 70, align: "right" }); doc.text(`${formatCurrency(paid)} (${percent}%)`, 485, y, { width: 65, align: "right" }); y+=12;
  doc.fillColor("#ef4444").text("Remaining:", 400, y, { width: 70, align: "right" }); doc.text(formatCurrency(loan.remaining), 485, y, { width: 65, align: "right" }); y+=14;
  doc.fillColor("black").moveTo(40, y).lineTo(555, y).strokeColor("#e2e8f0").stroke(); y+=10;
  // Progress bar
  doc.fillColor("#e2e8f0").rect(40, y, 515, 8).fill();
  doc.fillColor(loan.status === "Paid" ? "#10b981" : loan.status === "Overdue" ? "#ef4444" : "#6366f1").rect(40, y, 515 * (percent/100), 8).fill();
  y+=16;
  doc.fillColor("#64748b").font("Helvetica").fontSize(7).text(`${percent}% paid • ${loan.status === "Paid" ? "Fully paid ✓" : `Pay ${formatCurrency(loan.remaining)} to complete`}`, 40, y, { align: "center", width: 515 });

  y += 30;
  doc.fillColor("#64748b").fontSize(7).text(`Official receipt • ${shop.shopName} • ${shop.phone} • ${shop.email} • ${new Date().toLocaleString()}`, 40, y, { align: "center", width: 515 });
  doc.text(`Receipt link: ${process.env.FRONTEND_URL || "https://musiramuloan.netlify.app"}/receipt/${loan.loanId}`, 40, y+10, { align: "center", width: 515 });

  doc.end();
};

export const exportLoansCsv = async (req, res) => {
  const loans = await Loan.find().populate("customer").sort({ createdAt: -1 });
  const header = "loanId,customer,phone,items,principal,remaining,status,dueDate,createdAt\n";
  const rows = loans.map(l=> {
    const cust = l.customer ? `${l.customer.firstName} ${l.customer.lastName}` : "";
    const phone = l.customer?.phone || "";
    const items = `"${String(l.items).replace(/"/g,'""')}"`;
    return `${l.loanId},${cust},${phone},${items},${l.principal},${l.remaining},${l.status},${new Date(l.dueDate).toISOString().slice(0,10)},${new Date(l.createdAt).toISOString().slice(0,10)}`;
  }).join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=loans.csv");
  res.send(header + rows);
};

export const sendReminder = async (req, res) => {
  const loan = await Loan.findById(req.params.id).populate("customer");
  if (!loan) return res.status(404).json({ message: "Loan not found" });
  if (loan.remaining === 0) return res.status(400).json({ message: "Loan already paid" });
  const daysLeft = Math.ceil((new Date(loan.dueDate) - new Date()) / (1000 * 60 * 60 * 24));
  const daysOverdue = daysLeft < 0 ? Math.ceil((Date.now() - new Date(loan.dueDate)) / (1000 * 60 * 60 * 24)) : 0;
  const detail = loan.status === "Overdue"
    ? `Manual 3-day reminder — Overdue ${daysOverdue} days, Remaining: ${loan.remaining} RWF. Due was ${new Date(loan.dueDate).toISOString().slice(0,10)} — Click to view/pay.`
    : `Manual 3-day reminder — Due in ${daysLeft} day(s) on ${new Date(loan.dueDate).toISOString().slice(0,10)}, Remaining: ${loan.remaining} RWF. Tap to view/pay.`;
  await notifyShopOwner({
    type: "reminder",
    customerName: loan.customer ? `${loan.customer.firstName} ${loan.customer.lastName}` : "Customer",
    amount: loan.remaining,
    loanId: loan.loanId,
    loanDbId: loan._id,
    customerId: loan.customer?._id,
    ownerId: req.user._id,
    details: detail,
  });
  loan.lastReminderAt = new Date();
  if (loan.status === "Overdue") loan.lastOverdueNotifiedAt = new Date();
  await loan.save();
  res.json({ message: "Reminder sent to customer and admin", loanId: loan.loanId });
};

export const addItemsToLoan = async (req, res) => {
  const { lineItems, dueDate } = req.body;
  const loan = await Loan.findById(req.params.id).populate("customer");
  if (!loan) return res.status(404).json({message:"Loan not found"});
  if (loan.status === "Paid") return res.status(400).json({message:"Cannot add items to a paid loan"});
  const valid = (lineItems||[]).filter(it=> it.name && it.name.trim() && Number(it.qty)>0 && Number(it.price)>0);
  if (!valid.length && !dueDate) return res.status(400).json({message:"Provide lineItems to add or new dueDate"});
  let added = 0;
  const previousPrincipal = loan.principal;
  const previousDueDate = loan.dueDate;
  let newLineItems = [];
  if(valid.length){
    added = valid.reduce((a,it)=> a + Number(it.qty)*Number(it.price), 0);
    newLineItems = valid.map(it=>({ name: it.name.trim(), qty: Number(it.qty), price: Number(it.price) }));
    loan.lineItems.push(...newLineItems);
    const addedStr = newLineItems.map(it=> `${it.qty}× ${it.name} — ${Number(it.price).toLocaleString()} RWF`).join(", ");
    loan.items = loan.items ? `${loan.items}, ${addedStr}` : addedStr;
    loan.principal += added;
    loan.remaining += added;
  }
  let dueDateChanged = false;
  if(dueDate){
    const newDue = new Date(dueDate);
    if(isNaN(newDue)) return res.status(400).json({message:"Invalid dueDate"});
    if(newDue.getTime() !== new Date(loan.dueDate).getTime()) dueDateChanged = true;
    loan.dueDate = newDue;
  }
  // update status based on new dueDate and remaining
  if(loan.remaining === 0) loan.status = "Paid";
  else if(loan.dueDate < new Date()) loan.status = "Overdue";
  else loan.status = "Pending";
  // record history entry with date
  const historyDate = new Date();
  if(valid.length){
    loan.history.push({
      type: "add_items",
      date: historyDate,
      lineItems: newLineItems,
      addedAmount: added,
      previousPrincipal,
      newPrincipal: loan.principal,
      previousDueDate,
      newDueDate: loan.dueDate,
      note: `Added ${newLineItems.length} items (+${added} RWF)`,
      createdBy: req.user._id,
    });
  } else if(dueDateChanged){
    loan.history.push({
      type: "due_date_update",
      date: historyDate,
      lineItems: [],
      addedAmount: 0,
      previousPrincipal,
      newPrincipal: loan.principal,
      previousDueDate,
      newDueDate: loan.dueDate,
      note: `Due date changed to ${loan.dueDate.toISOString().slice(0,10)}`,
      createdBy: req.user._id,
    });
  }
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
