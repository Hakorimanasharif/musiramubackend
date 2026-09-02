import express from "express";
import { getCustomers, getCustomerById, createCustomer, deleteCustomer } from "../controllers/customerController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);
router.get("/", getCustomers);
router.get("/:id", getCustomerById);
router.post("/", createCustomer);
router.delete("/:id", deleteCustomer);

export default router;
