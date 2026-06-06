import { db } from "../db.js";
import { estimateTokenCostUsd } from "./ai-cost.js";
import type { AiResult } from "../types.js";

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function ensureUsageRow(vendorId: number, month: string) {
  db.prepare(
    `INSERT INTO usage_monthly (vendor_id, month, messages_in, messages_out, ai_replies, ai_tokens_in, ai_tokens_out, ai_cost_usd)
     VALUES (?, ?, 0, 0, 0, 0, 0, 0) ON CONFLICT(vendor_id, month) DO NOTHING`
  ).run(vendorId, month);
}

export function recordAiTokenUsage(
  vendorId: number,
  result: Pick<AiResult, "provider" | "model" | "tokensIn" | "tokensOut">,
  purpose?: string
): void {
  const tokensIn = result.tokensIn ?? 0;
  const tokensOut = result.tokensOut ?? 0;
  if (tokensIn === 0 && tokensOut === 0) return;

  const cost = estimateTokenCostUsd(result.provider, result.model, tokensIn, tokensOut);
  const month = currentMonth();
  ensureUsageRow(vendorId, month);
  db.prepare(
    `UPDATE usage_monthly SET
      ai_tokens_in = ai_tokens_in + ?,
      ai_tokens_out = ai_tokens_out + ?,
      ai_cost_usd = ai_cost_usd + ?
     WHERE vendor_id = ? AND month = ?`
  ).run(tokensIn, tokensOut, cost, vendorId, month);

  db.prepare(
    `INSERT INTO ai_usage_log (vendor_id, provider, model, tokens_in, tokens_out, cost_usd, purpose)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(vendorId, result.provider, result.model, tokensIn, tokensOut, cost, purpose ?? null);
}

export function getTokenUsage(vendorId: number, month = currentMonth()) {
  ensureUsageRow(vendorId, month);
  const row = db
    .prepare(
      "SELECT ai_tokens_in, ai_tokens_out, ai_cost_usd, ai_replies FROM usage_monthly WHERE vendor_id = ? AND month = ?"
    )
    .get(vendorId, month) as
    | { ai_tokens_in: number; ai_tokens_out: number; ai_cost_usd: number; ai_replies: number }
    | undefined;
  return {
    tokensIn: row?.ai_tokens_in ?? 0,
    tokensOut: row?.ai_tokens_out ?? 0,
    costUsd: row?.ai_cost_usd ?? 0,
    aiReplies: row?.ai_replies ?? 0,
  };
}

export function getPlatformTokenUsage(month = currentMonth()) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(ai_tokens_in), 0) ti, COALESCE(SUM(ai_tokens_out), 0) to_,
              COALESCE(SUM(ai_cost_usd), 0) cost, COALESCE(SUM(ai_replies), 0) replies
       FROM usage_monthly WHERE month = ?`
    )
    .get(month) as { ti: number; to_: number; cost: number; replies: number };
  return {
    tokensIn: row.ti,
    tokensOut: row.to_,
    costUsd: row.cost,
    aiReplies: row.replies,
  };
}

export function getDailyAiUsage(vendorId: number | null, days = 7) {
  const sql = vendorId
    ? `SELECT date(created_at) d,
              SUM(tokens_in) ti, SUM(tokens_out) tout, SUM(cost_usd) cost, COUNT(*) calls
       FROM ai_usage_log WHERE vendor_id = ? AND created_at >= datetime('now', ?)
       GROUP BY date(created_at) ORDER BY d`
    : `SELECT date(created_at) d,
              SUM(tokens_in) ti, SUM(tokens_out) tout, SUM(cost_usd) cost, COUNT(*) calls
       FROM ai_usage_log WHERE created_at >= datetime('now', ?)
       GROUP BY date(created_at) ORDER BY d`;
  const offset = `-${days} days`;
  const rows = vendorId
    ? (db.prepare(sql).all(vendorId, offset) as {
        d: string;
        ti: number;
        tout: number;
        cost: number;
        calls: number;
      }[])
    : (db.prepare(sql).all(offset) as {
        d: string;
        ti: number;
        tout: number;
        cost: number;
        calls: number;
      }[]);
  return rows.map((r) => ({
    date: r.d,
    tokensIn: r.ti,
    tokensOut: r.tout,
    costUsd: r.cost,
    calls: r.calls,
  }));
}
