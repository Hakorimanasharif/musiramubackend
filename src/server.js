import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import connectDB from "./config/db.js";

import authRoutes from "./routes/auth.js";
import customerRoutes from "./routes/customers.js";
import loanRoutes from "./routes/loans.js";
import statsRoutes from "./routes/stats.js";
import shopRoutes from "./routes/shop.js";
import smsRoutes from "./routes/sms.js";
import emailRoutes from "./routes/email.js";

dotenv.config();
const app = express();

// Security: optional helmet/rate-limit (installed)
let helmet, rateLimit;
try { helmet = (await import("helmet")).default; } catch {}
try { rateLimit = (await import("express-rate-limit")).default; } catch {}

if (helmet) app.use(helmet());
if (rateLimit) {
  app.use(rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false }));
  // stricter for public receipt enumeration
  app.use("/api/loans/receipt", rateLimit({ windowMs: 60*60*1000, max: 100, message: { message: "Too many receipt requests, try later" } }));
}

const allowedOrigins = [process.env.FRONTEND_URL, "https://musiramuloan.netlify.app"].filter(Boolean);
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    if (/^http:\/\/localhost:\d+$/.test(origin)) return callback(null, true);
    if (/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) return callback(null, true);
    if (/^https:\/\/.*\.netlify\.app$/.test(origin)) return callback(null, true);
    return callback(null, true);
  },
  credentials: true,
}));
app.use(express.json());
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

import mongoose from "mongoose";
import Loan from "./models/Loan.js";

await connectDB();

// background: auto-mark overdue loans every 10 minutes
setInterval(async () => {
  try {
    await Loan.updateMany({ dueDate: { $lt: new Date() }, remaining: { $gt: 0 }, status: "Pending" }, { $set: { status: "Overdue" } });
  } catch (e) { console.warn("overdue cron failed", e.message); }
}, 10 * 60 * 1000);

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
