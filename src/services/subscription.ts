import { db } from "../db.js";
import { getPlan, type PlanId } from "./plans.js";

function addMonths(iso: string, months: number): string {
  const d = new Date(iso);
  d.setMonth(d.getMonth() + months);
  return d.toISOString();
}

export function getSubscription(vendorId: number) {
  return db.prepare("SELECT * FROM subscriptions WHERE vendor_id = ?").get(vendorId) as
    | {
        vendor_id: number;
        plan: string;
        status: string;
        messages_limit: number;
        period_start: string;
        period_end: string;
      }
    | undefined;
}

export function activateSubscription(vendorId: number, planId: PlanId, months = 1): void {
  const plan = getPlan(planId);
  const now = new Date().toISOString();
  const end = addMonths(now, months);
  db.prepare(
    `INSERT INTO subscriptions (vendor_id, plan, status, messages_limit, period_start, period_end, updated_at)
     VALUES (?, ?, 'active', ?, ?, ?, datetime('now'))
     ON CONFLICT(vendor_id) DO UPDATE SET
       plan = excluded.plan, status = 'active', messages_limit = excluded.messages_limit,
       period_start = excluded.period_start, period_end = excluded.period_end, updated_at = datetime('now')`
  ).run(vendorId, planId, plan.messagesPerMonth, now, end);
  db.prepare("UPDATE vendors SET plan = ?, status = 'active', updated_at = datetime('now') WHERE id = ?").run(
    planId,
    vendorId
  );
}

export function startTrial(vendorId: number): void {
  const plan = getPlan("trial");
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 14);
  db.prepare(
    `INSERT INTO subscriptions (vendor_id, plan, status, messages_limit, period_start, period_end, updated_at)
     VALUES (?, 'trial', 'active', ?, ?, ?, datetime('now'))
     ON CONFLICT(vendor_id) DO NOTHING`
  ).run(vendorId, plan.messagesPerMonth, now.toISOString(), end.toISOString());
}

export function isSubscriptionActive(vendorId: number): boolean {
  const sub = getSubscription(vendorId);
  if (!sub) return true;
  if (sub.status !== "active") return false;
  return new Date(sub.period_end) >= new Date();
}
