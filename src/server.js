import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import connectDB from "./config/db.js";

import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customers.js";
import loanRoutes from "./routes/loans.js";
import statsRoutes from "./routes/stats.js";
import shopRoutes from "./routes/shop.js";
import smsRoutes from "./routes/sms.js";
import emailRoutes from "./routes/email.js";
import cronRoutes from "./routes/cron.js";

dotenv.config();
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use("/api/loans/receipt", rateLimit({ windowMs: 60*60*1000, max: 100, message: { message: "Too many receipt requests, try later" } }));

const allowedOrigins = [process.env.FRONTEND_URL, "https://musiramuloan.netlify.app", "http://localhost:5177", "http://localhost:5173"].filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (/^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return callback(null, true);
    if (/^https:\/\/.*\.netlify\.app$/.test(origin)) return callback(null, true);
    // allow all for now to prevent CORS block, reflect origin
    return callback(null, true);
  },
  credentials: true,
  methods: ["GET","POST","PUT","DELETE","OPTIONS"],
  allowedHeaders: ["Content-Type","Authorization"],
}));
app.options("*", cors());
app.use(express.json());
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

import mongoose from "mongoose";
import cron from "node-cron";
import { runReminderJob } from "./jobs/reminders.js";

await connectDB();

// background: auto-mark overdue + daily reminder (SMS + email to customer AND admin)
// - runs immediately on startup (so Render restarts don't wait 10 min)
// - every 10 min (retry failed sends; 24h cutoff per loan)
// - daily at 08:00 Africa/Kigali (fixed "every day" time, not just 24h-after-last-send)
let reminderRunning = false;
const runRemindersSafe = async (reason) => {
  if (reminderRunning) {
    console.log(`⏭️ Reminder job already running, skipping (${reason})`);
    return null;
  }
  reminderRunning = true;
  try {
    console.log(`⏰ Reminder job starting (${reason})...`);
    return await runReminderJob();
  } catch (e) {
    console.warn("reminder cron failed", e.message);
    return { error: e.message };
  } finally {
    reminderRunning = false;
  }
};

runRemindersSafe("startup");
setInterval(() => runRemindersSafe("10min-interval"), 10 * 60 * 1000);
cron.schedule("0 8 * * *", () => runRemindersSafe("daily-8am-kigali"), { timezone: "Africa/Kigali" });

app.get("/", (req,res)=> res.json({ message:"CreditLedger API running", version:"1.0.0" }));
app.get("/api/health", (req,res)=> {
  const states = ["disconnected","connected","connecting","disconnecting"];
  const dbState = states[mongoose.connection.readyState] || "unknown";
  res.json({ status:"ok", db: dbState });
});

app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/loans", loanRoutes);
app.use("/api/stats", statsRoutes);
app.use("/api/shop", shopRoutes);
app.use("/api/sms", smsRoutes);
app.use("/api/email", emailRoutes);
app.use("/api/cron", cronRoutes);

// 404 for unknown api routes
app.use((req,res)=> res.status(404).json({ message: "Not found" }));
// error handler - preserve status
app.use((err, req, res, next)=>{
  console.error(err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({ message: err.message || "Server error" });
});

const PORT = process.env.PORT ? Number(process.env.PORT) : 5001;
app.listen(PORT, ()=> console.log(`🚀 CreditLedger API on http://localhost:${PORT}`));
