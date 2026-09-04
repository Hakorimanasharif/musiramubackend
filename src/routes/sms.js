import express from "express";
import { protect } from "../middleware/auth.js";
import sendSMS, { sendOTP, getSmsBalance, formatRwPhone } from "../utils/sms.js";
import SmsLog from "../models/SmsLog.js";

const router = express.Router();

// All SMS routes require auth (shop owner only)
router.use(protect);

// POST /api/sms/send - test or manual send
// Body: { to: "+250788123456" or ["+250..."], message: "Hello" }
router.post("/send", async (req, res) => {
  try {
    const { to, message, text } = req.body;
    const result = await sendSMS({ to, message: message || text });
    if (result.simulated) {
      return res.json({ simulated: true, message: "SMS simulated (no ESMS_API_KEY) - check server console", ...result });
    }
    if (result.success) return res.json({ success: true, ...result });
    return res.status(502).json({ success: false, ...result });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/sms/otp - send OTP
// Body: { to: "+250788123456", purpose: "login" }
router.post("/otp", async (req, res) => {
  try {
    const { to, purpose } = req.body;
    if (!to) return res.status(400).json({ message: "to phone required" });
    const result = await sendOTP({ to, purpose });
    // In production you should store otp hashed in DB/Redis with expiry - here we return for demo if simulated
    if (result.simulated) return res.json({ simulated: true, otp: result.otp, message: "OTP simulated - check server console" });
    // Never leak OTP when real SMS sent - store hashed server-side in future
    const { otp: _omit, ...safe } = result;
    return res.json({ success: safe.success ?? true, simulated: false, message: "OTP sent via SMS", to: safe.to });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/sms/balance - check wallet
router.get("/balance", async (req, res) => {
  const bal = await getSmsBalance();
  if (bal.success) return res.json(bal);
  return res.status(502).json(bal);
});

// GET /api/sms/logs - delivery reports
router.get("/logs", async (req, res) => {
  const { page = 1, limit = 20, type, to, unread } = req.query;
  const q = {};
  if (type) q.type = type;
  if (to) q.to = { $regex: String(to).replace(/\D/g,""), $options: "i" };
  if (unread === "true") q.read = false;
  const total = await SmsLog.countDocuments(q);
  const unreadCount = await SmsLog.countDocuments({ read: false });
  const logs = await SmsLog.find(q).sort({ createdAt: -1 }).skip((page-1)*limit).limit(Number(limit));
  res.json({ logs, total, unreadCount, page: Number(page), pages: Math.ceil(total/limit) });
});

// PUT /api/sms/read-all - mark all as read
router.put("/read-all", async (req, res) => {
  await SmsLog.updateMany({ read: false }, { $set: { read: true, readAt: new Date() } });
  res.json({ message: "All notifications marked as read" });
});

// PUT /api/sms/:id/read - mark single as read
router.put("/:id/read", async (req, res) => {
  const log = await SmsLog.findById(req.params.id);
  if (!log) return res.status(404).json({ message: "Not found" });
  log.read = true;
  log.readAt = new Date();
  await log.save();
  res.json(log);
});

// GET /api/sms/format?phone=0788123456 - debug formatter
router.get("/format", (req, res) => {
  const { phone } = req.query;
  res.json({ input: phone, formatted: formatRwPhone(phone), example: "+250788123456" });
});

export default router;
