import { db } from "../db.js";
import { logger } from "../logger.js";
import { handleIncomingComment } from "./inbox.js";
import { getVendorConfig, vendorFacebookConfigured } from "./vendor.js";

/** Poll Page posts for new comments when Meta feed webhooks don't arrive. */
export async function syncVendorComments(vendorId: number): Promise<number> {
  const cfg = getVendorConfig(vendorId);
  if (!vendorFacebookConfigured(cfg)) return 0;

  const fields = "id,comments.limit(25){id,from,message,created_time}";
  const url =
    `https://graph.facebook.com/${cfg.fbGraphVersion}/${cfg.fbPageId}/posts` +
    `?fields=${encodeURIComponent(fields)}&limit=15` +
    `&access_token=${encodeURIComponent(cfg.fbPageAccessToken)}`;

  const res = await fetch(url);
  const data: any = await res.json();
  if (!res.ok || data.error) {
    logger.warn(`[vendor ${vendorId}] Comment sync: ${data.error?.message ?? res.status}`);
    return 0;
  }

  let synced = 0;
  for (const post of data.data ?? []) {
    const postId = String(post.id ?? "");
    for (const c of post.comments?.data ?? []) {
      const commentId = String(c.id ?? "");
      const message = String(c.message ?? "").trim();
      if (!commentId || !message) continue;

      const fromId = c.from?.id ? String(c.from.id) : null;
      if (fromId && fromId === cfg.fbPageId) continue;

      const exists = db
        .prepare("SELECT id FROM comments WHERE vendor_id = ? AND fb_comment_id = ?")
        .get(vendorId, commentId);
      if (exists) continue;

      await handleIncomingComment(
        vendorId,
        commentId,
        postId,
        c.from?.name ?? null,
        message,
        cfg.fbPageId
      );
      synced++;
    }
  }

  if (synced > 0) logger.info(`[vendor ${vendorId}] Synced ${synced} new comment(s) from Graph API`);
  return synced;
}

export async function syncAllVendorComments(): Promise<void> {
  const vendors = db
    .prepare(
      "SELECT DISTINCT vendor_id FROM vendor_settings WHERE key = 'FB_PAGE_ID' AND value != ''"
    )
    .all() as { vendor_id: number }[];

  for (const { vendor_id } of vendors) {
    try {
      await syncVendorComments(vendor_id);
    } catch (err) {
      logger.error(`[vendor ${vendor_id}] Comment sync failed`, err);
    }
  }
}
