import { db } from "../db.js";
import { config } from "../config.js";
import { activateSubscription } from "./subscription.js";
import { getPlan, type PlanId } from "./plans.js";
import { getPlatformPaymentConfig, paymentsConfigured } from "./platform-payments.js";
import { logger } from "../logger.js";

export type PaymentGateway = "bkash" | "nagad" | "sslcommerz";

export interface PaymentRecord {
  id: number;
  vendor_id: number;
  plan: string;
  amount: number;
  currency: string;
  gateway: string;
  transaction_id: string | null;
  status: string;
  metadata: string | null;
  created_at: string;
}

export function createPayment(vendorId: number, planId: PlanId, gateway: PaymentGateway): PaymentRecord {
  const plan = getPlan(planId);
  if (!plan.priceBdt) throw new Error("This plan requires custom pricing — contact sales");
  const txnId = `SAP-${vendorId}-${Date.now()}`;
  const info = db
    .prepare(
      `INSERT INTO payments (vendor_id, plan, amount, currency, gateway, transaction_id, status)
       VALUES (?, ?, ?, 'BDT', ?, ?, 'pending')`
    )
    .run(vendorId, planId, plan.priceBdt, gateway, txnId);
  return db.prepare("SELECT * FROM payments WHERE id = ?").get(info.lastInsertRowid) as PaymentRecord;
}

export function getPayment(id: number): PaymentRecord | null {
  return (db.prepare("SELECT * FROM payments WHERE id = ?").get(id) as PaymentRecord) ?? null;
}

/** Initiate payment — returns instructions/redirect for the gateway. */
export function initiatePayment(payment: PaymentRecord): {
  paymentId: number;
  gateway: string;
  amount: number;
  transactionId: string;
  redirectUrl?: string;
  instructions: string;
} {
  const payCfg = getPlatformPaymentConfig();
  const base = config.platform.publicBaseUrl.replace(/\/$/, "");
  const cb = `${base}/api/billing/callback/${payment.gateway}`;

  if (payment.gateway === "sslcommerz") {
    const storeId = payCfg.sslcommerzStoreId;
    const host = payCfg.sslcommerzSandbox ? "sandbox.sslcommerz.com" : "securepay.sslcommerz.com";
    const redirectUrl = storeId
      ? `https://${host}/gwprocess/v4/api.php?store_id=${storeId}&tran_id=${payment.transaction_id}&total_amount=${payment.amount}&currency=BDT&success_url=${encodeURIComponent(cb)}&fail_url=${encodeURIComponent(cb)}&cancel_url=${encodeURIComponent(cb)}`
      : undefined;
    return {
      paymentId: payment.id,
      gateway: payment.gateway,
      amount: payment.amount,
      transactionId: payment.transaction_id!,
      redirectUrl,
      instructions: redirectUrl
        ? "Redirecting to SSLCommerz secure payment…"
        : "SSLCommerz not configured — ask admin to set Store ID & Password in Payment Config.",
    };
  }

  if (payment.gateway === "bkash") {
    const configured = paymentsConfigured().bkash;
    const merchant = payCfg.bkashMerchantNumber || "SocialAI Pro";
    return {
      paymentId: payment.id,
      gateway: payment.gateway,
      amount: payment.amount,
      transactionId: payment.transaction_id!,
      instructions: configured
        ? `bKash payment ৳${payment.amount} — send to ${merchant}. Reference: ${payment.transaction_id}. Payment will be verified automatically.`
        : `bKash not configured — admin must add API credentials in Payment Config. Reference: ${payment.transaction_id}`,
    };
  }

  const nagadConfigured = paymentsConfigured().nagad;
  const nagadMerchant = payCfg.nagadMerchantNumber || payCfg.nagadMerchantId || "SocialAI Pro";
  return {
    paymentId: payment.id,
    gateway: payment.gateway,
    amount: payment.amount,
    transactionId: payment.transaction_id!,
    instructions: nagadConfigured
      ? `Nagad payment ৳${payment.amount} — pay to ${nagadMerchant}. Reference: ${payment.transaction_id}.`
      : `Nagad not configured — admin must add API credentials in Payment Config. Reference: ${payment.transaction_id}`,
  };
}

export function completePayment(paymentId: number, externalTxn?: string): boolean {
  const payment = getPayment(paymentId);
  if (!payment || payment.status === "completed") return false;
  db.prepare("UPDATE payments SET status = 'completed', metadata = ? WHERE id = ?").run(
    externalTxn ?? null,
    paymentId
  );
  activateSubscription(payment.vendor_id, payment.plan as PlanId);
  logger.info(`Payment #${paymentId} completed — vendor ${payment.vendor_id} activated on ${payment.plan}`);
  return true;
}

export function listPayments(vendorId?: number): PaymentRecord[] {
  if (vendorId) {
    return db
      .prepare("SELECT * FROM payments WHERE vendor_id = ? ORDER BY id DESC LIMIT 100")
      .all(vendorId) as PaymentRecord[];
  }
  return db.prepare("SELECT * FROM payments ORDER BY id DESC LIMIT 200").all() as PaymentRecord[];
}
