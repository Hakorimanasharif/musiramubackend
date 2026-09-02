import express from "express";
import { protect } from "../middleware/auth.js";
import { sendEmail, getEmailStatus } from "../utils/email.js";
import { notifyShopOwner } from "../utils/shopNotifier.js";

const router = express.Router();

// GET /api/email/status - check if real email configured
router.get("/status", protect, async (req, res) => {
  const status = await getEmailStatus();
  res.json(status);
});

// POST /api/email/send - direct email test
// Body: { to: "test@example.com", subject: "Hello", text: "body", html: "<p>...</p>" }
router.post("/send", protect, async (req, res) => {
  try {
    const { to, subject, text, html } = req.body;
    if (!to || !subject) return res.status(400).json({ message: "to and subject required" });
    const result = await sendEmail({ to, subject, text: text || "Test from MusiRamu", html });
    if (result.simulated && result.error) return res.status(502).json(result);
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/email/test-notify - triggers shopNotifier (email + SMS together)
// Body: { type: "customer"|"loan"|"payment", customerName: "John Doe" }
router.post("/test-notify", protect, async (req, res) => {
  try {
    const { type = "customer", customerName = "Test Customer", amount = 5000 } = req.body;
    const result = await notifyShopOwner({
      type,
      customerName,
      amount,
      loanId: "L-TEST999",
      ownerId: req.user._id,
      details: "Manual test trigger from /api/email/test-notify - checks both Email + SMS",
    });
    res.json({ success: true, message: "Both Email + SMS triggered (check server console & inbox)", ...result });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default router;
