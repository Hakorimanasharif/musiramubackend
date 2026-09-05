import express from "express";
import { getLoans, createLoan, collectPayment, getLoanById, addItemsToLoan, getLoanReceipt, getLoanReceiptPdf, getPaymentHistory, getLoanHistory, exportLoansCsv, sendReminder } from "../controllers/loanController.js";
import { protect } from "../middleware/auth.js";

const router = express.Router();
router.get("/receipt/:loanId/pdf", getLoanReceiptPdf);
router.get("/receipt/:loanId", getLoanReceipt);
router.use(protect);
router.get("/export/csv", exportLoansCsv);
router.get("/", getLoans);
router.post("/", createLoan);
router.get("/:id", getLoanById);
router.get("/:id/payments", getPaymentHistory);
router.get("/:id/history", getLoanHistory);
router.post("/:id/pay", collectPayment);
router.post("/:id/remind", sendReminder);
router.put("/:id/add-items", addItemsToLoan);

export default router;
