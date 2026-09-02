import Loan from "../models/Loan.js";
import Customer from "../models/Customer.js";
import Log from "../models/Log.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

export const getStats = async (req, res) => {
  const loans = await Loan.find().lean();
  const totalOutstanding = loans.reduce((a,l)=>a+l.remaining,0);
  const activeDebtors = new Set(loans.filter(l=>l.remaining>0).map(l=>String(l.customer))).size;
  const overdueBalance = loans.filter(l=>l.status==="Overdue").reduce((a,l)=>a+l.remaining,0);
  const collected = loans.reduce((a,l)=>a+(l.principal - l.remaining),0);
  const overdueLoans = await Loan.find({ status:"Overdue" }).populate("customer").limit(10).lean();
  const logs = await Log.find().sort({ createdAt: -1 }).limit(10).lean();
  res.json({ totalOutstanding, activeDebtors, overdueBalance, collected, overdueLoans, logs });
};

export const getLogs = async (req, res) => {
  const logs = await Log.find().sort({ createdAt: -1 }).limit(20);
  res.json(logs);
};
