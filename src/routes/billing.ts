import { Router } from "express";
import { db } from "../db.js";
import { listPublicPlans } from "../services/plans.js";
import { createPayment, initiatePayment, completePayment } from "../services/payments.js";
import { requireAuth, requireVendor, type AuthedRequest } from "../middleware/auth.js";
import { getPlatformPaymentConfig } from "../services/platform-payments.js";
import type { PlanId } from "../services/plans.js";
import type { PaymentGateway } from "../services/payments.js";

export const billingRouter = Router();

billingRouter.get("/plans", (_req, res) => {
  const sales = getPlatformPaymentConfig();
  res.json({
    plans: listPublicPlans(),
    salesEmail: sales.salesEmail,
    salesWhatsApp: sales.salesWhatsapp,
  });
});

billingRouter.post("/subscribe", requireAuth, requireVendor, (req: AuthedRequest, res) => {
  const { plan, gateway } = req.body ?? {};
  const vendorId = req.user!.vendorId!;
  if (!plan || !gateway) return res.status(400).json({ error: "plan and gateway required" });
  if (!["pro", "elite"].includes(plan)) {
    return res.status(400).json({ error: "Enterprise plans — contact sales", contact: getPlatformPaymentConfig().salesEmail });
  }
  if (!["bkash", "nagad", "sslcommerz"].includes(gateway)) {
    return res.status(400).json({ error: "Invalid gateway" });
  }
  try {
    const payment = createPayment(vendorId, plan as PlanId, gateway as PaymentGateway);
    const result = initiatePayment(payment);
    res.json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

function completeByTxn(txn: string): void {
  const row = db
    .prepare("SELECT id FROM payments WHERE transaction_id = ? AND status = 'pending'")
    .get(txn) as { id: number } | undefined;
  if (row) completePayment(row.id, txn);
}

billingRouter.post("/callback/:gateway", (req, res) => {
  const txn = String(req.body?.tran_id ?? req.body?.transaction_id ?? "");
  const status = req.body?.status;
  if (txn && status !== "FAILED" && status !== "CANCELLED") completeByTxn(txn);
  res.send("OK");
});

billingRouter.get("/callback/:gateway", (req, res) => {
  const txn = String(req.query.tran_id ?? req.query.transaction_id ?? "");
  if (txn) completeByTxn(txn);
  res.redirect("/?payment=success");
});
