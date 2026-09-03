import express from "express";
import { register, login, me, updateProfile, forgotPassword, verifyOtp, resetPassword } from "../controllers/authController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();

router.post("/register", register);
router.post("/login", login);
router.post("/forgot", forgotPassword);
router.post("/verify-otp", verifyOtp);
router.post("/reset", resetPassword);
router.get("/me", protect, me);
router.put("/me", protect, updateProfile);

export default router;
