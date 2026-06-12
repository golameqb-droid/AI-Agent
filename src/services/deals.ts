import { db } from "../db.js";
import type { OrderItem } from "../types.js";

export const PIPELINE_STAGES = ["new", "interested", "quoted", "negotiating", "won", "lost"] as const;
export type DealStage = (typeof PIPELINE_STAGES)[number];

export interface Deal {
  id: number;
  vendor_id: number;
  customer_id: number | null;
  conversation_id: number | null;
  stage: DealStage;
  title: string | null;
  value_estimate: string | null;
  product_ids_json: string | null;
  items_json: string | null;
  lost_reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
}

export interface DealPayload {
  stage?: DealStage;
  title?: string;
  value_estimate?: string;
  product_ids?: number[];
  items?: OrderItem[];
}

export function listDeals(vendorId: number, stage?: string): Deal[] {
  if (stage) {
    return db
      .prepare("SELECT * FROM deals WHERE vendor_id = ? AND stage = ? ORDER BY updated_at DESC LIMIT 500")
      .all(vendorId, stage) as Deal[];
  }
  return db
    .prepare("SELECT * FROM deals WHERE vendor_id = ? ORDER BY updated_at DESC LIMIT 500")
    .all(vendorId) as Deal[];
}

export function getDeal(vendorId: number, dealId: number): Deal | null {
  return (db.prepare("SELECT * FROM deals WHERE id = ? AND vendor_id = ?").get(dealId, vendorId) as Deal) ?? null;
}

export function getOpenDealForConversation(vendorId: number, conversationId: number): Deal | null {
  return (
    (db
      .prepare(
        `SELECT * FROM deals WHERE vendor_id = ? AND conversation_id = ? AND stage NOT IN ('won','lost') ORDER BY id DESC LIMIT 1`
      )
      .get(vendorId, conversationId) as Deal) ?? null
  );
}

export function createDeal(
  vendorId: number,
  data: {
    customer_id?: number | null;
    conversation_id?: number | null;
    stage?: DealStage;
    title?: string;
    value_estimate?: string;
    product_ids?: number[];
    items?: OrderItem[];
    source?: string;
  }
): Deal {
  const info = db
    .prepare(
      `INSERT INTO deals (vendor_id, customer_id, conversation_id, stage, title, value_estimate, product_ids_json, items_json, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      vendorId,
      data.customer_id ?? null,
      data.conversation_id ?? null,
      data.stage ?? "new",
      data.title?.trim() || null,
      data.value_estimate?.trim() || null,
      data.product_ids?.length ? JSON.stringify(data.product_ids) : null,
      data.items?.length ? JSON.stringify(data.items) : null,
      data.source ?? "ai"
    );
  return db.prepare("SELECT * FROM deals WHERE id = ?").get(info.lastInsertRowid) as Deal;
}

export function updateDealStage(
  vendorId: number,
  dealId: number,
  stage: DealStage,
  lostReason?: string
): Deal | null {
  const closed = stage === "won" || stage === "lost";
  db.prepare(
    `UPDATE deals SET stage = ?, lost_reason = COALESCE(?, lost_reason),
     closed_at = CASE WHEN ? THEN datetime('now') ELSE closed_at END,
     updated_at = datetime('now') WHERE id = ? AND vendor_id = ?`
  ).run(stage, lostReason ?? null, closed ? 1 : 0, dealId, vendorId);
  return getDeal(vendorId, dealId);
}

export function upsertDealFromAi(
  vendorId: number,
  conversationId: number,
  customerId: number | null,
  payload: DealPayload
): Deal {
  const existing = getOpenDealForConversation(vendorId, conversationId);
  const stage = payload.stage && PIPELINE_STAGES.includes(payload.stage) ? payload.stage : "interested";

  if (existing) {
    const productIds = payload.product_ids?.length
      ? JSON.stringify(payload.product_ids)
      : existing.product_ids_json;
    const items = payload.items?.length ? JSON.stringify(payload.items) : existing.items_json;
    db.prepare(
      `UPDATE deals SET stage = ?, title = COALESCE(?, title), value_estimate = COALESCE(?, value_estimate),
       product_ids_json = COALESCE(?, product_ids_json), items_json = COALESCE(?, items_json),
       customer_id = COALESCE(?, customer_id), updated_at = datetime('now') WHERE id = ?`
    ).run(
      stage,
      payload.title?.trim() || null,
      payload.value_estimate?.trim() || null,
      productIds,
      items,
      customerId,
      existing.id
    );
    return getDeal(vendorId, existing.id)!;
  }

  return createDeal(vendorId, {
    customer_id: customerId,
    conversation_id: conversationId,
    stage,
    title: payload.title,
    value_estimate: payload.value_estimate,
    product_ids: payload.product_ids,
    items: payload.items,
    source: "ai",
  });
}

export function markDealWon(vendorId: number, conversationId: number, orderId?: number): void {
  const deal = getOpenDealForConversation(vendorId, conversationId);
  if (!deal) return;
  updateDealStage(vendorId, deal.id, "won");
  if (orderId) {
    db.prepare("UPDATE orders SET deal_id = ? WHERE id = ? AND vendor_id = ?").run(deal.id, orderId, vendorId);
  }
}

export function getPipelineSummary(vendorId: number): Record<string, number> {
  const rows = db
    .prepare("SELECT stage, COUNT(*) c FROM deals WHERE vendor_id = ? GROUP BY stage")
    .all(vendorId) as { stage: string; c: number }[];
  const out: Record<string, number> = {};
  for (const s of PIPELINE_STAGES) out[s] = 0;
  for (const r of rows) out[r.stage] = r.c;
  return out;
}

export function countDealsConverted(vendorId: number): number {
  return (db.prepare("SELECT COUNT(*) c FROM deals WHERE vendor_id = ? AND stage = 'won'").get(vendorId) as { c: number }).c;
}
