import express from "express";
import { getCustomers, getCustomerById, createCustomer, deleteCustomer, getCustomerStatementPdf, exportCustomersCsv, importCustomersCsv } from "../controllers/customerController.js";
import { getCustomerPayments } from "../controllers/loanController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.use(protect);
router.get("/export/csv", exportCustomersCsv);
router.post("/import/csv", importCustomersCsv);
router.get("/:id/statement/pdf", getCustomerStatementPdf);
router.get("/:id/payments", getCustomerPayments);
router.get("/", getCustomers);
router.get("/:id", getCustomerById);
router.post("/", createCustomer);
router.delete("/:id", deleteCustomer);

export default router;
