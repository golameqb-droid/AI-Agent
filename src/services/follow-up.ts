import { db } from "../db.js";
import { logger } from "../logger.js";
import { getVendorConfig } from "./vendor.js";
import { sendText } from "./channels.js";
import { isHandoffActive } from "./handoff.js";
import { isSubscriptionActive } from "./subscription.js";
import { canUseAi, recordMessageOut } from "./usage.js";
import type { Channel } from "../types.js";
import type { Conversation } from "../types.js";

export type FollowUpTrigger =
  | "no_reply"
  | "stage_stale"
  | "order_pending"
  | "cart_abandoned";

export interface FollowUpRule {
  id: number;
  vendor_id: number;
  trigger: FollowUpTrigger;
  delay_hours: number;
  message_template: string;
  enabled: number;
  max_attempts: number;
  created_at: string;
}

const DEFAULT_RULES: Omit<FollowUpRule, "id" | "vendor_id" | "created_at">[] = [
  {
    trigger: "no_reply",
    delay_hours: 24,
    message_template:
      "আসসালামু আলাইকুম! আপনার প্রশ্নের উত্তর দিতে পারলাম কি? যেকোনো সাহায্য লাগলে জানাবেন — আমরা পাশে আছি।",
    enabled: 1,
    max_attempts: 2,
  },
  {
    trigger: "stage_stale",
    delay_hours: 48,
    message_template:
      "আপনি যে প্রোডাক্ট/সার্ভিস নিয়ে জানতে চেয়েছিলেন — এখনও আগ্রহী থাকলে রিপ্লাই দিন, সাহায্য করতে পারি।",
    enabled: 1,
    max_attempts: 2,
  },
  {
    trigger: "cart_abandoned",
    delay_hours: 2,
    message_template:
      "আপনি অর্ডার শুরু করেছিলেন কিন্তু শেষ করেননি — কোনো সমস্যা হলে জানান, আমরা সাহায্য করব।",
    enabled: 1,
    max_attempts: 3,
  },
  {
    trigger: "order_pending",
    delay_hours: 12,
    message_template: "আপনার অর্ডার এখনও পেন্ডিং — কনফার্ম করতে চান? রিপ্লাই করুন।",
    enabled: 1,
    max_attempts: 1,
  },
];

export function ensureDefaultRules(vendorId: number): void {
  const count = (db.prepare("SELECT COUNT(*) c FROM follow_up_rules WHERE vendor_id = ?").get(vendorId) as { c: number }).c;
  if (count > 0) return;
  const ins = db.prepare(
    `INSERT INTO follow_up_rules (vendor_id, trigger, delay_hours, message_template, enabled, max_attempts) VALUES (?, ?, ?, ?, ?, ?)`
  );
  for (const r of DEFAULT_RULES) {
    ins.run(vendorId, r.trigger, r.delay_hours, r.message_template, r.enabled, r.max_attempts);
  }
}

export function listRules(vendorId: number): FollowUpRule[] {
  ensureDefaultRules(vendorId);
  return db
    .prepare("SELECT * FROM follow_up_rules WHERE vendor_id = ? ORDER BY trigger")
    .all(vendorId) as FollowUpRule[];
}

export function updateRule(
  vendorId: number,
  ruleId: number,
  patch: Partial<Pick<FollowUpRule, "delay_hours" | "message_template" | "enabled" | "max_attempts">>
): void {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.delay_hours !== undefined) {
    sets.push("delay_hours = ?");
    vals.push(patch.delay_hours);
  }
  if (patch.message_template !== undefined) {
    sets.push("message_template = ?");
    vals.push(patch.message_template);
  }
  if (patch.enabled !== undefined) {
    sets.push("enabled = ?");
    vals.push(patch.enabled);
  }
  if (patch.max_attempts !== undefined) {
    sets.push("max_attempts = ?");
    vals.push(patch.max_attempts);
  }
  if (!sets.length) return;
  vals.push(ruleId, vendorId);
  db.prepare(`UPDATE follow_up_rules SET ${sets.join(", ")} WHERE id = ? AND vendor_id = ?`).run(...vals);
}

export function cancelFollowUpsForConversation(conversationId: number): void {
  db.prepare(
    "UPDATE follow_up_queue SET status = 'cancelled' WHERE conversation_id = ? AND status = 'pending'"
  ).run(conversationId);
}

export function queueFollowUp(
  vendorId: number,
  data: {
    conversation_id: number;
    customer_id?: number | null;
    deal_id?: number | null;
    cart_intent_id?: number | null;
    rule_id: number;
    scheduled_at: string;
    message_text: string;
  }
): void {
  const dup = db
    .prepare(
      `SELECT id FROM follow_up_queue WHERE vendor_id = ? AND conversation_id = ? AND rule_id = ? AND status = 'pending'`
    )
    .get(vendorId, data.conversation_id, data.rule_id);
  if (dup) return;

  db.prepare(
    `INSERT INTO follow_up_queue (vendor_id, conversation_id, customer_id, deal_id, cart_intent_id, rule_id, scheduled_at, message_text, status, attempt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0)`
  ).run(
    vendorId,
    data.conversation_id,
    data.customer_id ?? null,
    data.deal_id ?? null,
    data.cart_intent_id ?? null,
    data.rule_id,
    data.scheduled_at,
    data.message_text
  );
}

export function listQueue(vendorId: number, status = "pending"): unknown[] {
  return db
    .prepare(
      "SELECT * FROM follow_up_queue WHERE vendor_id = ? AND status = ? ORDER BY scheduled_at LIMIT 200"
    )
    .all(vendorId, status);
}

function scheduleAt(hours: number): string {
  const d = new Date();
  d.setHours(d.getHours() + hours);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

export function scanStaleConversations(vendorId: number): number {
  ensureDefaultRules(vendorId);
  const rules = listRules(vendorId).filter((r) => r.enabled);
  let queued = 0;

  for (const rule of rules) {
    if (rule.trigger === "no_reply") {
      const convos = db
        .prepare(
          `SELECT c.* FROM conversations c
           WHERE c.vendor_id = ? AND c.handoff_status = 'ai'
           AND c.updated_at <= datetime('now', '-' || ? || ' hours')
           AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.direction = 'out' AND m.created_at > c.updated_at)`
        )
        .all(vendorId, rule.delay_hours) as Conversation[];

      for (const c of convos) {
        const attempts = (
          db
            .prepare(
              "SELECT COUNT(*) n FROM follow_up_queue WHERE conversation_id = ? AND rule_id = ? AND status = 'sent'"
            )
            .get(c.id, rule.id) as { n: number }
        ).n;
        if (attempts >= rule.max_attempts) continue;
        queueFollowUp(vendorId, {
          conversation_id: c.id,
          customer_id: (c as any).customer_id ?? null,
          rule_id: rule.id,
          scheduled_at: scheduleAt(0),
          message_text: rule.message_template,
        });
        queued++;
      }
    }

    if (rule.trigger === "stage_stale") {
      const deals = db
        .prepare(
          `SELECT d.*, c.id as conv_id FROM deals d
           JOIN conversations c ON c.id = d.conversation_id
           WHERE d.vendor_id = ? AND d.stage IN ('interested','quoted','negotiating')
           AND d.updated_at <= datetime('now', '-' || ? || ' hours')`
        )
        .all(vendorId, rule.delay_hours) as any[];

      for (const d of deals) {
        queueFollowUp(vendorId, {
          conversation_id: d.conversation_id,
          customer_id: d.customer_id,
          deal_id: d.id,
          rule_id: rule.id,
          scheduled_at: scheduleAt(0),
          message_text: rule.message_template,
        });
        queued++;
      }
    }

    if (rule.trigger === "order_pending") {
      const orders = db
        .prepare(
          `SELECT o.* FROM orders o
           WHERE o.vendor_id = ? AND o.status = 'pending'
           AND o.created_at <= datetime('now', '-' || ? || ' hours')
           AND o.conversation_id IS NOT NULL`
        )
        .all(vendorId, rule.delay_hours) as any[];

      for (const o of orders) {
        queueFollowUp(vendorId, {
          conversation_id: o.conversation_id,
          customer_id: o.customer_id,
          rule_id: rule.id,
          scheduled_at: scheduleAt(0),
          message_text: rule.message_template,
        });
        queued++;
      }
    }
  }
  return queued;
}

export async function processFollowUpQueue(): Promise<void> {
  const due = db
    .prepare(
      `SELECT q.*, c.channel, c.psid, c.handoff_status FROM follow_up_queue q
       JOIN conversations c ON c.id = q.conversation_id
       WHERE q.status = 'pending' AND q.scheduled_at <= datetime('now')
       ORDER BY q.scheduled_at LIMIT 30`
    )
    .all() as any[];

  for (const row of due) {
    if (row.handoff_status === "human_active") {
      db.prepare("UPDATE follow_up_queue SET status = 'cancelled' WHERE id = ?").run(row.id);
      continue;
    }
    if (!isSubscriptionActive(row.vendor_id)) {
      db.prepare("UPDATE follow_up_queue SET status = 'cancelled' WHERE id = ?").run(row.id);
      continue;
    }

    const cfg = getVendorConfig(row.vendor_id);
    const usage = canUseAi(row.vendor_id);
    if (!usage.ok) continue;

    try {
      await sendText(cfg, row.channel as Channel, row.psid, row.message_text);
      recordMessageOut(row.vendor_id);
      db.prepare(
        "INSERT INTO messages (conversation_id, direction, text, status) VALUES (?, 'out', ?, 'sent')"
      ).run(row.conversation_id, row.message_text);
      db.prepare(
        "UPDATE follow_up_queue SET status = 'sent', sent_at = datetime('now'), attempt = attempt + 1 WHERE id = ?"
      ).run(row.id);
      db.prepare(
        "UPDATE conversations SET last_message = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(row.message_text, row.conversation_id);
      logger.info(`[vendor ${row.vendor_id}] Follow-up sent to conv ${row.conversation_id}`);
    } catch (err) {
      logger.error(`[vendor ${row.vendor_id}] Follow-up failed`, err);
    }
  }
}

export function countFollowUpsSent(vendorId: number, days = 30): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) c FROM follow_up_queue WHERE vendor_id = ? AND status = 'sent' AND sent_at >= datetime('now', '-' || ? || ' days')"
      )
      .get(vendorId, days) as { c: number }
  ).c;
}
