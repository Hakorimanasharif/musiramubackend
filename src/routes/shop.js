import express from "express";
import { getShopProfile, updateShopProfile } from "../controllers/shopController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);
router.get("/", getShopProfile);
router.put("/", updateShopProfile);

export default router;
