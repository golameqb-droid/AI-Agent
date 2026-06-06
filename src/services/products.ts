import fs from "node:fs";
import path from "node:path";
import { db } from "../db.js";
import { config } from "../config.js";
import type { Product } from "../types.js";

export function listProducts(vendorId: number, activeOnly = false): Product[] {
  const sql = activeOnly
    ? "SELECT * FROM products WHERE vendor_id = ? AND active = 1 ORDER BY sort_order, id"
    : "SELECT * FROM products WHERE vendor_id = ? ORDER BY sort_order, id";
  return db.prepare(sql).all(vendorId) as Product[];
}

export function getProduct(vendorId: number, productId: number): Product | null {
  return (
    (db
      .prepare("SELECT * FROM products WHERE id = ? AND vendor_id = ?")
      .get(productId, vendorId) as Product) ?? null
  );
}

export function createProduct(
  vendorId: number,
  data: { name: string; description?: string; price?: string; image_url?: string; link?: string }
): Product {
  const info = db
    .prepare(
      "INSERT INTO products (vendor_id, name, description, price, image_url, link) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(
      vendorId,
      data.name,
      data.description ?? null,
      data.price ?? null,
      data.image_url ?? null,
      data.link ?? null
    );
  return db.prepare("SELECT * FROM products WHERE id = ?").get(info.lastInsertRowid) as Product;
}

export function updateProduct(
  vendorId: number,
  productId: number,
  data: Partial<{ name: string; description: string; price: string; image_url: string; link: string; active: number }>
): Product | null {
  const existing = getProduct(vendorId, productId);
  if (!existing) return null;
  db.prepare(
    `UPDATE products SET name=?, description=?, price=?, image_url=?, link=?, active=?
     WHERE id=? AND vendor_id=?`
  ).run(
    data.name ?? existing.name,
    data.description !== undefined ? data.description : existing.description,
    data.price !== undefined ? data.price : existing.price,
    data.image_url !== undefined ? data.image_url : existing.image_url,
    data.link !== undefined ? data.link : existing.link,
    data.active !== undefined ? data.active : existing.active,
    productId,
    vendorId
  );
  return getProduct(vendorId, productId);
}

export function deleteProduct(vendorId: number, productId: number): boolean {
  const r = db.prepare("DELETE FROM products WHERE id = ? AND vendor_id = ?").run(productId, vendorId);
  return r.changes > 0;
}

/** Text block for AI system prompt. */
export function formatProductsForAi(vendorId: number): string {
  const products = listProducts(vendorId, true);
  if (!products.length) return "(No products in catalog yet.)";
  return products
    .map(
      (p) =>
        `- [ID:${p.id}] ${p.name}${p.price ? ` — ${p.price}` : ""}${p.description ? `: ${p.description}` : ""}${p.link ? ` (link: ${p.link})` : ""}`
    )
    .join("\n");
}

/** Resolve image URL to absolute public URL for Facebook Messenger. */
export function resolvePublicImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://")) return imageUrl;
  const base = config.platform.publicBaseUrl.replace(/\/$/, "");
  return `${base}${imageUrl.startsWith("/") ? "" : "/"}${imageUrl}`;
}

export function vendorUploadsDir(vendorId: number): string {
  const dir = path.join(config.paths.uploads, String(vendorId));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
