import { db } from "../db.js";
import type { Order, OrderItem, OrderStatus } from "../types.js";

export interface OrderPayload {
  customer_name?: string;
  phone?: string;
  address?: string;
  items: OrderItem[];
  notes?: string;
  total?: string;
}

function nextOrderNumber(vendorId: number): string {
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const prefix = `ORD-${vendorId}-${today}-`;
  const last = db
    .prepare("SELECT order_number FROM orders WHERE vendor_id = ? AND order_number LIKE ? ORDER BY id DESC LIMIT 1")
    .get(vendorId, `${prefix}%`) as { order_number: string } | undefined;
  const seq = last ? Number(last.order_number.slice(prefix.length)) + 1 : 1;
  return `${prefix}${String(seq).padStart(3, "0")}`;
}

function parseItems(json: string): OrderItem[] {
  try {
    const items = JSON.parse(json) as OrderItem[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function calcTotal(items: OrderItem[], explicit?: string): string | null {
  if (explicit?.trim()) return explicit.trim();
  const nums = items
    .map((i) => {
      const p = (i.price ?? "").replace(/[^\d.]/g, "");
      const n = Number(p);
      return Number.isFinite(n) ? n * (i.qty || 1) : 0;
    })
    .filter((n) => n > 0);
  if (!nums.length) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return `৳${sum}`;
}

export function listOrders(vendorId: number, status?: string): Order[] {
  if (status) {
    return db
      .prepare("SELECT * FROM orders WHERE vendor_id = ? AND status = ? ORDER BY id DESC LIMIT 500")
      .all(vendorId, status) as Order[];
  }
  return db
    .prepare("SELECT * FROM orders WHERE vendor_id = ? ORDER BY id DESC LIMIT 500")
    .all(vendorId) as Order[];
}

export function getOrder(vendorId: number, orderId: number): Order | null {
  return (
    (db.prepare("SELECT * FROM orders WHERE id = ? AND vendor_id = ?").get(orderId, vendorId) as Order) ??
    null
  );
}

export function countPendingOrders(vendorId: number): number {
  return (db.prepare("SELECT COUNT(*) c FROM orders WHERE vendor_id = ? AND status = 'pending'").get(vendorId) as { c: number }).c;
}

export function createOrder(
  vendorId: number,
  data: {
    conversation_id?: number | null;
    customer_id?: number | null;
    deal_id?: number | null;
    customer_name?: string;
    customer_phone?: string;
    customer_address?: string;
    items: OrderItem[];
    total?: string;
    notes?: string;
    source?: string;
  }
): Order {
  const items = data.items.filter((i) => i.name?.trim());
  if (!items.length) throw new Error("Order must have at least one item");
  const itemsJson = JSON.stringify(items);
  const total = calcTotal(items, data.total);
  const info = db
    .prepare(
      `INSERT INTO orders (vendor_id, conversation_id, customer_id, deal_id, order_number, customer_name, customer_phone,
        customer_address, items_json, total, notes, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      vendorId,
      data.conversation_id ?? null,
      data.customer_id ?? null,
      data.deal_id ?? null,
      nextOrderNumber(vendorId),
      data.customer_name?.trim() || null,
      data.customer_phone?.trim() || null,
      data.customer_address?.trim() || null,
      itemsJson,
      total,
      data.notes?.trim() || null,
      data.source ?? "manual"
    );
  return db.prepare("SELECT * FROM orders WHERE id = ?").get(info.lastInsertRowid) as Order;
}

export function createOrderFromAi(
  vendorId: number,
  conversationId: number,
  payload: OrderPayload,
  customerName: string | null,
  customerId?: number | null,
  dealId?: number | null
): Order | null {
  if (!payload.items?.length) return null;
  const items = payload.items.filter((i) => i.name?.trim());
  if (!items.length) return null;
  return createOrder(vendorId, {
    conversation_id: conversationId,
    customer_id: customerId ?? null,
    deal_id: dealId ?? null,
    customer_name: payload.customer_name || customerName || undefined,
    customer_phone: payload.phone,
    customer_address: payload.address,
    items,
    total: payload.total,
    notes: payload.notes,
    source: "ai",
  });
}

export function updateOrderStatus(
  vendorId: number,
  orderId: number,
  status: OrderStatus,
  notes?: string
): Order | null {
  const existing = getOrder(vendorId, orderId);
  if (!existing) return null;
  db.prepare(
    "UPDATE orders SET status = ?, notes = COALESCE(?, notes), updated_at = datetime('now') WHERE id = ? AND vendor_id = ?"
  ).run(status, notes ?? null, orderId, vendorId);
  return getOrder(vendorId, orderId);
}

export function orderToPublic(order: Order) {
  return { ...order, items: parseItems(order.items_json) };
}

export function formatItemsForDisplay(itemsJson: string): string {
  return parseItems(itemsJson)
    .map((i) => `${i.name} ×${i.qty || 1}${i.price ? ` (${i.price})` : ""}`)
    .join("; ");
}

/** CSV export (opens in Excel). */
export function ordersToCsv(orders: Order[]): string {
  const header = [
    "Order Number",
    "Date",
    "Customer",
    "Phone",
    "Address",
    "Items",
    "Total",
    "Status",
    "Source",
    "Notes",
  ];
  const rows = orders.map((o) => [
    o.order_number,
    o.created_at,
    o.customer_name ?? "",
    o.customer_phone ?? "",
    o.customer_address ?? "",
    formatItemsForDisplay(o.items_json),
    o.total ?? "",
    o.status,
    o.source,
    o.notes ?? "",
  ]);
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...rows].map((r) => r.map((c) => esc(String(c))).join(",")).join("\n");
}
