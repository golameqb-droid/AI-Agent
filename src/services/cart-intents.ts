import { db } from "../db.js";
import type { OrderItem } from "../types.js";
import { ensureDefaultRules, queueFollowUp, listRules } from "./follow-up.js";

export type CartStatus = "active" | "abandoned" | "converted" | "expired";

export interface CartIntent {
  id: number;
  vendor_id: number;
  conversation_id: number;
  customer_id: number | null;
  deal_id: number | null;
  items_json: string;
  status: CartStatus;
  last_activity_at: string;
  abandoned_at: string | null;
  converted_order_id: number | null;
  created_at: string;
  updated_at: string;
}

export interface CartPayload {
  items: OrderItem[];
}

const BUY_INTENT_RE =
  /\b(order|buy|purchase|কিনব|অর্ডার|নিব|নেব|চাই|লাগবে|price|দাম|কত|koto|pice)\b/i;

export function detectBuyIntent(text: string): boolean {
  return BUY_INTENT_RE.test(text);
}

export function getActiveCart(vendorId: number, conversationId: number): CartIntent | null {
  return (
    (db
      .prepare(
        `SELECT * FROM cart_intents WHERE vendor_id = ? AND conversation_id = ? AND status IN ('active','abandoned') ORDER BY id DESC LIMIT 1`
      )
      .get(vendorId, conversationId) as CartIntent) ?? null
  );
}

export function upsertCartFromAi(
  vendorId: number,
  conversationId: number,
  customerId: number | null,
  dealId: number | null,
  items: OrderItem[]
): CartIntent {
  const filtered = items.filter((i) => i.name?.trim());
  if (!filtered.length) throw new Error("Cart must have items");

  const existing = getActiveCart(vendorId, conversationId);
  const json = JSON.stringify(filtered);

  if (existing && existing.status !== "converted") {
    db.prepare(
      `UPDATE cart_intents SET items_json = ?, customer_id = COALESCE(?, customer_id), deal_id = COALESCE(?, deal_id),
       status = 'active', last_activity_at = datetime('now'), abandoned_at = NULL, updated_at = datetime('now') WHERE id = ?`
    ).run(json, customerId, dealId, existing.id);
    return db.prepare("SELECT * FROM cart_intents WHERE id = ?").get(existing.id) as CartIntent;
  }

  const info = db
    .prepare(
      `INSERT INTO cart_intents (vendor_id, conversation_id, customer_id, deal_id, items_json, status, last_activity_at)
       VALUES (?, ?, ?, ?, ?, 'active', datetime('now'))`
    )
    .run(vendorId, conversationId, customerId, dealId, json);
  return db.prepare("SELECT * FROM cart_intents WHERE id = ?").get(info.lastInsertRowid) as CartIntent;
}

export function touchCartActivity(vendorId: number, conversationId: number): void {
  db.prepare(
    `UPDATE cart_intents SET last_activity_at = datetime('now'), status = 'active', abandoned_at = NULL, updated_at = datetime('now')
     WHERE vendor_id = ? AND conversation_id = ? AND status IN ('active','abandoned')`
  ).run(vendorId, conversationId);
}

export function markCartConverted(vendorId: number, conversationId: number, orderId: number): void {
  db.prepare(
    `UPDATE cart_intents SET status = 'converted', converted_order_id = ?, updated_at = datetime('now')
     WHERE vendor_id = ? AND conversation_id = ? AND status IN ('active','abandoned')`
  ).run(orderId, vendorId, conversationId);
}

export function listCartIntents(vendorId: number, status?: CartStatus): CartIntent[] {
  if (status) {
    return db
      .prepare("SELECT * FROM cart_intents WHERE vendor_id = ? AND status = ? ORDER BY updated_at DESC LIMIT 200")
      .all(vendorId, status) as CartIntent[];
  }
  return db
    .prepare("SELECT * FROM cart_intents WHERE vendor_id = ? ORDER BY updated_at DESC LIMIT 200")
    .all(vendorId) as CartIntent[];
}

export function scanAbandonedCarts(vendorId: number): number {
  ensureDefaultRules(vendorId);
  const rule = listRules(vendorId).find((r) => r.trigger === "cart_abandoned" && r.enabled);
  if (!rule) return 0;

  const carts = db
    .prepare(
      `SELECT * FROM cart_intents WHERE vendor_id = ? AND status = 'active'
       AND last_activity_at <= datetime('now', '-' || ? || ' hours')`
    )
    .all(vendorId, rule.delay_hours) as CartIntent[];

  let n = 0;
  for (const cart of carts) {
    db.prepare(
      "UPDATE cart_intents SET status = 'abandoned', abandoned_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(cart.id);

    const items = JSON.parse(cart.items_json) as OrderItem[];
    const names = items.map((i) => i.name).join(", ");
    const msg = rule.message_template.replace("{items}", names);

    queueFollowUp(vendorId, {
      conversation_id: cart.conversation_id,
      customer_id: cart.customer_id,
      deal_id: cart.deal_id,
      cart_intent_id: cart.id,
      rule_id: rule.id,
      scheduled_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      message_text: msg,
    });
    n++;
  }
  return n;
}

export function countAbandonedCarts(vendorId: number): number {
  return (
    db.prepare("SELECT COUNT(*) c FROM cart_intents WHERE vendor_id = ? AND status = 'abandoned'").get(vendorId) as {
      c: number;
    }
  ).c;
}

export function countRecoveredCarts(vendorId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) c FROM cart_intents WHERE vendor_id = ? AND status = 'converted' AND abandoned_at IS NOT NULL"
      )
      .get(vendorId) as { c: number }
  ).c;
}

export function recoveredRevenueEstimate(vendorId: number): string {
  const rows = db
    .prepare(
      `SELECT o.total FROM cart_intents c JOIN orders o ON o.id = c.converted_order_id
       WHERE c.vendor_id = ? AND c.abandoned_at IS NOT NULL AND c.status = 'converted'`
    )
    .all(vendorId) as { total: string | null }[];
  let sum = 0;
  for (const r of rows) {
    const n = Number((r.total ?? "").replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) sum += n;
  }
  return sum > 0 ? `৳${sum}` : "৳0";
}
