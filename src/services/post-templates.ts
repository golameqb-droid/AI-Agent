import { db } from "../db.js";

export interface PostTemplate {
  id: number;
  vendor_id: number;
  name: string;
  message: string;
  image_url: string | null;
  link: string | null;
  tags: string | null;
  created_at: string;
}

export function listTemplates(vendorId: number): PostTemplate[] {
  return db
    .prepare("SELECT * FROM post_templates WHERE vendor_id = ? ORDER BY id DESC")
    .all(vendorId) as PostTemplate[];
}

export function createTemplate(
  vendorId: number,
  data: { name: string; message: string; image_url?: string; link?: string; tags?: string }
): PostTemplate {
  const info = db
    .prepare("INSERT INTO post_templates (vendor_id, name, message, image_url, link, tags) VALUES (?, ?, ?, ?, ?, ?)")
    .run(vendorId, data.name, data.message, data.image_url ?? null, data.link ?? null, data.tags ?? null);
  return db.prepare("SELECT * FROM post_templates WHERE id = ?").get(info.lastInsertRowid) as PostTemplate;
}

export function deleteTemplate(vendorId: number, id: number): boolean {
  const r = db.prepare("DELETE FROM post_templates WHERE id = ? AND vendor_id = ?").run(id, vendorId);
  return r.changes > 0;
}
