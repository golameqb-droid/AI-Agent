import { db } from "../db.js";
import type { Channel } from "../types.js";

export interface Customer {
  id: number;
  vendor_id: number;
  primary_channel: string;
  primary_psid: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  tags_json: string | null;
  conversation_id: number | null;
  notes: string | null;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
}

export function upsertCustomerFromConversation(
  vendorId: number,
  channel: Channel,
  psid: string,
  conversationId: number,
  name?: string | null,
  phone?: string | null
): Customer {
  const existing = db
    .prepare(
      "SELECT * FROM customers WHERE vendor_id = ? AND primary_channel = ? AND primary_psid = ?"
    )
    .get(vendorId, channel, psid) as Customer | undefined;

  if (existing) {
    const updates: string[] = ["conversation_id = ?", "last_seen_at = datetime('now')", "updated_at = datetime('now')"];
    const params: unknown[] = [conversationId];
    if (name?.trim()) {
      updates.push("name = ?");
      params.push(name.trim());
    }
    if (phone?.trim()) {
      updates.push("phone = ?");
      params.push(phone.trim());
    }
    params.push(existing.id);
    db.prepare(`UPDATE customers SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    return db.prepare("SELECT * FROM customers WHERE id = ?").get(existing.id) as Customer;
  }

  const info = db
    .prepare(
      `INSERT INTO customers (vendor_id, primary_channel, primary_psid, name, phone, conversation_id, first_seen_at, last_seen_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
    .run(vendorId, channel, psid, name?.trim() || null, phone?.trim() || null, conversationId);

  const customerId = Number(info.lastInsertRowid);
  db.prepare("UPDATE conversations SET customer_id = ? WHERE id = ?").run(customerId, conversationId);
  return db.prepare("SELECT * FROM customers WHERE id = ?").get(customerId) as Customer;
}

export function updateCustomerFromOrder(customerId: number, name?: string, phone?: string): void {
  if (name?.trim()) db.prepare("UPDATE customers SET name = ?, updated_at = datetime('now') WHERE id = ?").run(name.trim(), customerId);
  if (phone?.trim()) db.prepare("UPDATE customers SET phone = ?, updated_at = datetime('now') WHERE id = ?").run(phone.trim(), customerId);
}

export function listCustomers(vendorId: number, q?: string): Customer[] {
  if (q?.trim()) {
    const like = `%${q.trim()}%`;
    return db
      .prepare(
        `SELECT * FROM customers WHERE vendor_id = ? AND (name LIKE ? OR phone LIKE ? OR primary_psid LIKE ?)
         ORDER BY last_seen_at DESC LIMIT 500`
      )
      .all(vendorId, like, like, like) as Customer[];
  }
  return db
    .prepare("SELECT * FROM customers WHERE vendor_id = ? ORDER BY last_seen_at DESC LIMIT 500")
    .all(vendorId) as Customer[];
}

export function getCustomer(vendorId: number, customerId: number): Customer | null {
  return (
    (db.prepare("SELECT * FROM customers WHERE id = ? AND vendor_id = ?").get(customerId, vendorId) as Customer) ??
    null
  );
}

export function getCustomerTimeline(vendorId: number, customerId: number) {
  const customer = getCustomer(vendorId, customerId);
  if (!customer) return null;

  const memories = db
    .prepare(
      "SELECT note, updated_at FROM customer_memory WHERE vendor_id = ? AND channel = ? AND psid = ? ORDER BY updated_at DESC"
    )
    .all(vendorId, customer.primary_channel, customer.primary_psid) as { note: string; updated_at: string }[];

  const orders = db
    .prepare("SELECT * FROM orders WHERE vendor_id = ? AND customer_id = ? ORDER BY id DESC")
    .all(vendorId, customerId);

  const deals = db
    .prepare("SELECT * FROM deals WHERE vendor_id = ? AND customer_id = ? ORDER BY id DESC")
    .all(vendorId, customerId);

  const messages = customer.conversation_id
    ? db
        .prepare(
          "SELECT direction, text, created_at FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 50"
        )
        .all(customer.conversation_id)
    : [];

  return { customer, memories, orders, deals, messages: (messages as any[]).reverse() };
}

export function countCustomers(vendorId: number): number {
  return (db.prepare("SELECT COUNT(*) c FROM customers WHERE vendor_id = ?").get(vendorId) as { c: number }).c;
}

export function countNewCustomers7d(vendorId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) c FROM customers WHERE vendor_id = ? AND first_seen_at >= datetime('now', '-7 days')"
      )
      .get(vendorId) as { c: number }
  ).c;
}

export function countCustomersWithOrders(vendorId: number): number {
  return (
    db
      .prepare("SELECT COUNT(DISTINCT customer_id) c FROM orders WHERE vendor_id = ? AND customer_id IS NOT NULL")
      .get(vendorId) as { c: number }
  ).c;
}

/** Backfill customers from existing conversations. */
export function backfillCustomers(vendorId: number): number {
  const convos = db
    .prepare("SELECT id, channel, psid, customer_name FROM conversations WHERE vendor_id = ? AND customer_id IS NULL")
    .all(vendorId) as { id: number; channel: Channel; psid: string; customer_name: string | null }[];
  let n = 0;
  for (const c of convos) {
    upsertCustomerFromConversation(vendorId, c.channel, c.psid, c.id, c.customer_name);
    n++;
  }
  return n;
}
