import { db } from "../db.js";

export type HandoffStatus = "ai" | "human_requested" | "human_active";

const HANDOFF_PATTERNS = [
  /\bhuman\b/i,
  /\bagent\b/i,
  /\brepresentative\b/i,
  /\bmanager\b/i,
  /\bmanush\b/i,
  /\bmanush\s*lagbe\b/i,
  /\bkothao\s*bolun\b/i,
  /\bphone\s*korte\b/i,
  /\bcall\s*koro\b/i,
  /\breal\s*person\b/i,
  /\btalk\s*to\s*(someone|person|human)\b/i,
  /কাউকে\s*ডাকুন/,
  /মানুষ\s*লাগবে/,
  /এজেন্ট/,
];

export function detectHandoffRequest(text: string): boolean {
  const t = text.trim();
  return HANDOFF_PATTERNS.some((p) => p.test(t));
}

export function getHandoffStatus(conversationId: number): HandoffStatus {
  const row = db
    .prepare("SELECT handoff_status FROM conversations WHERE id = ?")
    .get(conversationId) as { handoff_status: HandoffStatus } | undefined;
  return row?.handoff_status ?? "ai";
}

/** Only pause AI when a human vendor is actively replying — not when queued. */
export function isHandoffActive(conversationId: number): boolean {
  return getHandoffStatus(conversationId) === "human_active";
}

export function setHandoffStatus(conversationId: number, status: HandoffStatus): void {
  db.prepare(
    "UPDATE conversations SET handoff_status = ?, handoff_at = datetime('now'), updated_at = datetime('now') WHERE id = ?"
  ).run(status, conversationId);
}

export function countHandoffQueue(vendorId: number): number {
  return (
    db
      .prepare(
        "SELECT COUNT(*) c FROM conversations WHERE vendor_id = ? AND handoff_status = 'human_requested'"
      )
      .get(vendorId) as { c: number }
  ).c;
}
