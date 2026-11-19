import express from "express";
import { register, login, me, updateProfile, forgotPassword, verifyOtp, resetPassword } from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
// Express 4 needs rejected promises forwarded to its JSON error handler.
const handle = action => (req, res, next) => Promise.resolve().then(() => action(req, res, next)).catch(next);

router.post("/register", handle(register));
router.post("/login", handle(login));
router.post("/forgot", handle(forgotPassword));
router.post("/verify-otp", handle(verifyOtp));
router.post("/reset", handle(resetPassword));
router.get("/me", protect, handle(me));
router.put("/me", protect, handle(updateProfile));

export default router;
