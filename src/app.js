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
// Netlify terminates HTTPS at its trusted reverse proxy.
if (process.env.NETLIFY) app.set("trust proxy", 1);

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(rateLimit({ windowMs: 15*60*1000, max: 300, standardHeaders: true, legacyHeaders: false }));
app.use("/api/loans/receipt", rateLimit({ windowMs: 60*60*1000, max: 100, message: { message: "Too many receipt requests, try later" } }));

const allowedOrigins = new Set([
  process.env.FRONTEND_URL, process.env.URL, process.env.DEPLOY_PRIME_URL,
  "https://musiramuloan.netlify.app",
  "http://localhost:5177",
  ...(process.env.CORS_ORIGINS || "").split(",").map(value => value.trim()),
].filter(Boolean));
app.use(cors({
  origin: (origin, callback) => {
    const local = process.env.NODE_ENV !== "production" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
    callback(null, !origin || allowedOrigins.has(origin) || local);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Cron-Secret"],
}));
app.use(express.json());
if (process.env.NODE_ENV !== "production") app.use(morgan("dev"));

app.get("/", (req,res)=> res.json({ message:"CreditLedger API running", version:"1.0.0" }));
app.get("/api/health", async (req, res) => {
  try {
    await connectDB();
    res.json({ status: "ok", db: "connected" });
  } catch {
    res.status(503).json({ status: "unavailable", db: "disconnected" });
  }
});

// Connect lazily; an unavailable database must not kill the function process.
app.use("/api", async (req, res, next) => {
  res.set("Cache-Control", "no-store");
  try { await connectDB(); next(); }
  catch (error) {
    console.error("Database connection failed:", error.message);
    res.status(503).json({ message: "Database temporarily unavailable. Please try again." });
  }
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

export default app;
