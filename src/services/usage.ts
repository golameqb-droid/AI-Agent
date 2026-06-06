import { db } from "../db.js";
import { getPlan } from "./plans.js";
import { getVendorById } from "./vendor.js";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function ensureUsageRow(vendorId: number, month: string) {
  db.prepare(
    `INSERT INTO usage_monthly (vendor_id, month, messages_in, messages_out, ai_replies)
     VALUES (?, ?, 0, 0, 0) ON CONFLICT(vendor_id, month) DO NOTHING`
  ).run(vendorId, month);
}

export function recordMessageIn(vendorId: number): void {
  const month = currentMonth();
  ensureUsageRow(vendorId, month);
  db.prepare("UPDATE usage_monthly SET messages_in = messages_in + 1 WHERE vendor_id = ? AND month = ?").run(
    vendorId,
    month
  );
}

export function recordMessageOut(vendorId: number): void {
  const month = currentMonth();
  ensureUsageRow(vendorId, month);
  db.prepare("UPDATE usage_monthly SET messages_out = messages_out + 1 WHERE vendor_id = ? AND month = ?").run(
    vendorId,
    month
  );
}

export function recordAiReply(vendorId: number): void {
  const month = currentMonth();
  ensureUsageRow(vendorId, month);
  db.prepare("UPDATE usage_monthly SET ai_replies = ai_replies + 1 WHERE vendor_id = ? AND month = ?").run(
    vendorId,
    month
  );
}

export function getMonthlyUsage(vendorId: number, month = currentMonth()) {
  ensureUsageRow(vendorId, month);
  return db.prepare("SELECT * FROM usage_monthly WHERE vendor_id = ? AND month = ?").get(vendorId, month) as {
    vendor_id: number;
    month: string;
    messages_in: number;
    messages_out: number;
    ai_replies: number;
  };
}

export function getMessageLimit(vendorId: number): number {
  const vendor = getVendorById(vendorId);
  const sub = db.prepare("SELECT messages_limit FROM subscriptions WHERE vendor_id = ?").get(vendorId) as
    | { messages_limit: number }
    | undefined;
  if (sub) return sub.messages_limit;
  return getPlan(vendor?.plan ?? "trial").messagesPerMonth;
}

export function canUseAi(vendorId: number): { ok: boolean; reason?: string; used: number; limit: number } {
  const vendor = getVendorById(vendorId);
  if (!vendor) return { ok: false, reason: "Vendor not found", used: 0, limit: 0 };
  if (vendor.status === "suspended" || vendor.status === "cancelled") {
    return { ok: false, reason: "Account suspended", used: 0, limit: 0 };
  }
  const limit = getMessageLimit(vendorId);
  const usage = getMonthlyUsage(vendorId);
  const used = usage.ai_replies;
  if (limit < 0) return { ok: true, used, limit }; // unlimited enterprise
  if (used >= limit) return { ok: false, reason: "Monthly message limit reached. Upgrade your plan.", used, limit };
  return { ok: true, used, limit };
}
