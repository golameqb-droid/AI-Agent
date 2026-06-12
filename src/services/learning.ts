import { db } from "../db.js";
import type { Channel } from "./channels.js";

const MAX_CUSTOMER_NOTES = 15;
const MAX_VENDOR_LEARNINGS = 30;

/** Heuristic facts extracted from customer messages (no extra AI call). */
const MESSAGE_PATTERNS: { re: RegExp; note: (match: RegExpMatchArray) => string }[] = [
  {
    re: /\b(class|grade|শ্রেণি)\s*[-:]?\s*(\d+|৩|৪|৫|৬|৭|৮|৯|১০)\b/i,
    note: (m) => `Interested in class ${m[2]}`,
  },
  { re: /\b(ssc|hsc|bcs|nctb|admission)\b/i, note: (m) => `Asked about ${m[1].toUpperCase()}` },
  {
    re: /\b(coaching|school|institute|college|madrasa|মাদ্রাসা|কোচিং|স্কুল)\b/i,
    note: () => "May run or work at coaching/school/institute",
  },
  {
    re: /\b(pdf|omr|mcq|সৃজনশীল|question\s*paper|প্রশ্নপত্র)\b/i,
    note: () => "Interested in question papers / PDF / MCQ features",
  },
  {
    re: /\b(trial|ফ্রি|free)\b/i,
    note: () => "Interested in free trial",
  },
  {
    re: /\b(bkash|nagad|rocket|payment|পেমেন্ট)\b/i,
    note: () => "Asked about payment",
  },
];

export function saveCustomerMemories(
  vendorId: number,
  channel: Channel,
  psid: string,
  notes: string[]
): void {
  const stmt = db.prepare(
    `INSERT INTO customer_memory (vendor_id, channel, psid, note, updated_at)
     VALUES (?, ?, ?, ?, datetime('now'))
     ON CONFLICT(vendor_id, channel, psid, note) DO UPDATE SET updated_at = datetime('now')`
  );
  for (const raw of notes) {
    const note = raw.trim().slice(0, 240);
    if (!note) continue;
    stmt.run(vendorId, channel, psid, note);
  }
  trimCustomerMemories(vendorId, channel, psid);
}

function trimCustomerMemories(vendorId: number, channel: Channel, psid: string): void {
  const rows = db
    .prepare(
      `SELECT id FROM customer_memory WHERE vendor_id = ? AND channel = ? AND psid = ?
       ORDER BY updated_at DESC`
    )
    .all(vendorId, channel, psid) as { id: number }[];
  if (rows.length <= MAX_CUSTOMER_NOTES) return;
  const del = db.prepare("DELETE FROM customer_memory WHERE id = ?");
  for (const row of rows.slice(MAX_CUSTOMER_NOTES)) del.run(row.id);
}

export function learnFromCustomerMessage(
  vendorId: number,
  channel: Channel,
  psid: string,
  text: string
): void {
  const notes: string[] = [];
  for (const { re, note } of MESSAGE_PATTERNS) {
    const m = text.match(re);
    if (m) notes.push(note(m));
  }
  if (notes.length) saveCustomerMemories(vendorId, channel, psid, notes);
}

export function promoteVendorLearning(vendorId: number, note: string): void {
  const trimmed = note.trim().slice(0, 300);
  if (!trimmed) return;
  const existing = db
    .prepare("SELECT id, hits FROM vendor_learnings WHERE vendor_id = ? AND note = ?")
    .get(vendorId, trimmed) as { id: number; hits: number } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE vendor_learnings SET hits = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(existing.hits + 1, existing.id);
    return;
  }
  db.prepare(
    "INSERT INTO vendor_learnings (vendor_id, note) VALUES (?, ?)"
  ).run(vendorId, trimmed);
  const count = db
    .prepare("SELECT COUNT(*) c FROM vendor_learnings WHERE vendor_id = ?")
    .get(vendorId) as { c: number };
  if (count.c > MAX_VENDOR_LEARNINGS) {
    db.prepare(
      `DELETE FROM vendor_learnings WHERE id IN (
        SELECT id FROM vendor_learnings WHERE vendor_id = ? ORDER BY hits ASC, updated_at ASC LIMIT ?
      )`
    ).run(vendorId, count.c - MAX_VENDOR_LEARNINGS);
  }
}

export function formatCustomerMemory(
  vendorId: number,
  channel: Channel,
  psid: string
): string {
  const rows = db
    .prepare(
      `SELECT note FROM customer_memory WHERE vendor_id = ? AND channel = ? AND psid = ?
       ORDER BY updated_at DESC LIMIT 10`
    )
    .all(vendorId, channel, psid) as { note: string }[];
  if (!rows.length) return "";
  return rows.map((r) => `- ${r.note}`).join("\n");
}

export function listVendorLearnings(vendorId: number) {
  return db
    .prepare(
      `SELECT id, note, hits, created_at, updated_at FROM vendor_learnings WHERE vendor_id = ?
       ORDER BY hits DESC, updated_at DESC LIMIT 50`
    )
    .all(vendorId) as { id: number; note: string; hits: number; created_at: string; updated_at: string }[];
}

export function formatVendorLearnings(vendorId: number): string {
  const rows = db
    .prepare(
      `SELECT note FROM vendor_learnings WHERE vendor_id = ?
       ORDER BY hits DESC, updated_at DESC LIMIT 12`
    )
    .all(vendorId) as { note: string }[];
  if (!rows.length) return "";
  return rows.map((r) => `- ${r.note}`).join("\n");
}
