import { db } from "../db.js";

/** Load a vendor's knowledge base from the database. */
export function loadVendorKnowledge(vendorId: number): string {
  const row = db
    .prepare("SELECT content FROM vendor_knowledge WHERE vendor_id = ?")
    .get(vendorId) as { content: string } | undefined;
  return row?.content ?? "(No knowledge base provided yet.)";
}

export function saveVendorKnowledge(vendorId: number, content: string): void {
  db.prepare(
    `INSERT INTO vendor_knowledge (vendor_id, content, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(vendor_id) DO UPDATE SET content = excluded.content, updated_at = datetime('now')`
  ).run(vendorId, content);
}
