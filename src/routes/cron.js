import express from "express";
import jwt from "jsonwebtoken";
import rateLimit from "express-rate-limit";
import User from "../models/User.js";
import Loan from "../models/Loan.js";
import SmsLog from "../models/SmsLog.js";
import ShopProfile from "../models/ShopProfile.js";
import { runReminderJob } from "../jobs/reminders.js";

const router = express.Router();

// Prevent SMS spam via manual trigger: max 20 triggers/hour per IP
router.use(rateLimit({ windowMs: 60 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false }));

// Allow either: valid Bearer JWT (dashboard) OR CRON_SECRET (cron-job.org / uptime ping)
const cronAuth = async (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers["x-cron-secret"] || req.query.secret;
  if (secret && provided && provided === secret) return next();
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    try {
      const decoded = jwt.verify(auth.split(" ")[1], process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("-password");
      if (user) {
        req.user = user;
        return next();
      }
    } catch {}
  }
  // If CRON_SECRET is configured, require it (don't leak whether JWT failed)
  if (secret) return res.status(401).json({ message: "Not authorized — provide Bearer token or valid x-cron-secret" });
  return res.status(401).json({ message: "Not authorized, no token" });
};

// GET /api/cron/status — debug "why no message today?" without sending anything
router.get("/status", cronAuth, async (req, res) => {
  try {
    const now = new Date();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [total, overdue, overdueDue, pendingPastDue, upcoming3d] = await Promise.all([
      Loan.countDocuments(),
      Loan.countDocuments({ status: "Overdue", remaining: { $gt: 0 } }),
      Loan.countDocuments({ status: "Overdue", remaining: { $gt: 0 }, $or: [{ lastOverdueNotifiedAt: null }, { lastOverdueNotifiedAt: { $lt: cutoff } }] }),
      Loan.countDocuments({ status: "Pending", remaining: { $gt: 0 }, dueDate: { $lt: now } }),
      Loan.countDocuments({ status: "Pending", remaining: { $gt: 0 }, dueDate: { $gte: now, $lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) } }),
    ]);
    const shop = await ShopProfile.findOne().lean();
    const lastSms = await SmsLog.find().sort({ createdAt: -1 }).limit(5).lean();
    const smsToday = await SmsLog.countDocuments({ createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } });
    res.json({
      now,
      loans: { total, overdue, overdueDueNow: overdueDue, pendingPastDue, upcoming3d },
      notificationsEnabled: shop?.notifications ?? null,
      smsToday,
      lastSms: lastSms.map((s) => ({ at: s.createdAt, type: s.type, to: s.to, status: s.status, provider: s.provider, error: s.error })),
      smsProvider: {
        smsconnect: !!process.env.SMSCONNECT_API_KEY,
        esms: !!(process.env.ESMS_API_KEY || process.env.SMS_API_KEY),
      },
      hint:
        overdueDue === 0
          ? "Nothing to send: no overdue loans past the 24h cutoff (already notified <24h ago, all paid, or smsOnOverdue disabled)."
          : `${overdueDue} overdue loan(s) are due for a reminder on next run.`,
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET/POST /api/cron/reminders?force=1 — run the daily job on demand
router.all("/reminders", cronAuth, async (req, res) => {
  try {
    const force = req.query.force === "1" || req.query.force === "true" || req.body?.force === true;
    const result = await runReminderJob({ force });
    res.json({ success: true, ...result });
  } catch (e) {
    console.warn("manual reminder trigger failed", e.message);
    res.status(500).json({ success: false, message: e.message });
  }
});

export default router;
