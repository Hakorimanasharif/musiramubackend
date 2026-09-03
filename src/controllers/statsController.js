import Loan from "../models/Loan.js";
import Customer from "../models/Customer.js";
import Log from "../models/Log.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

export const getStats = async (req, res) => {
  const { from, to, period = "6m" } = req.query;
  let dateFilter = {};
  if (from || to) {
    dateFilter.createdAt = {};
    if (from) dateFilter.createdAt.$gte = new Date(from);
    if (to) dateFilter.createdAt.$lte = new Date(to);
  }
  const loans = await Loan.find(dateFilter).lean();
  const totalOutstanding = loans.reduce((a,l)=>a+l.remaining,0);
  const activeDebtors = new Set(loans.filter(l=>l.remaining>0).map(l=>String(l.customer))).size;
  const overdueBalance = loans.filter(l=>l.status==="Overdue").reduce((a,l)=>a+l.remaining,0);
  const collected = loans.reduce((a,l)=>a+(l.principal - l.remaining),0);
  // trend data with date range
  const overdueLoans = await Loan.find({ status:"Overdue", ...dateFilter }).populate("customer").limit(10).lean();
  const logs = await Log.find(dateFilter.createdAt ? { createdAt: dateFilter.createdAt } : {}).sort({ createdAt: -1 }).limit(10).lean();
  // monthly trend for last 6 or custom
  const months = period === "12m" ? 12 : 6;
  const trend = [];
  const now = new Date();
  for (let i=months-1; i>=0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth()-i, 1);
    const next = new Date(now.getFullYear(), now.getMonth()-i+1, 1);
    const sum = loans.filter(l=> l.createdAt >= d && l.createdAt < next).reduce((a,l)=>a+l.principal,0);
    trend.push({ label: d.toLocaleString("en-US",{month:"short"}), sum });
  }
  res.json({ totalOutstanding, activeDebtors, overdueBalance, collected, overdueLoans, logs, trend, period, from, to });
};

export const getLogs = async (req, res) => {
  const logs = await Log.find().sort({ createdAt: -1 }).limit(20);
  res.json(logs);
};
