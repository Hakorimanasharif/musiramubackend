import express from "express";
import { getStats, getLogs } from "../controllers/statsController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);
router.get("/", getStats);
router.get("/logs", getLogs);

export default router;
