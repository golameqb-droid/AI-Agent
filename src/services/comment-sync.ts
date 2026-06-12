import { db } from "../db.js";
import { logger } from "../logger.js";
import { handleIncomingComment } from "./inbox.js";
import { getVendorConfig, getVendorSetting, vendorFacebookConfigured } from "./vendor.js";
import { isOwnSocialComment } from "./comment-filter.js";

async function syncFacebookPostComments(vendorId: number, cfg: ReturnType<typeof getVendorConfig>): Promise<number> {
  const fields = "id,comments.limit(25){id,from,message,created_time}";
  const url =
    `https://graph.facebook.com/${cfg.fbGraphVersion}/${cfg.fbPageId}/posts` +
    `?fields=${encodeURIComponent(fields)}&limit=15` +
    `&access_token=${encodeURIComponent(cfg.fbPageAccessToken)}`;

  const res = await fetch(url);
  const data: any = await res.json();
  if (!res.ok || data.error) {
    logger.warn(`[vendor ${vendorId}] FB comment sync: ${data.error?.message ?? res.status}`);
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
      if (isOwnSocialComment(vendorId, cfg, { fromId, fromName: c.from?.name ?? null })) continue;

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
  return synced;
}

async function syncInstagramMediaComments(vendorId: number, cfg: ReturnType<typeof getVendorConfig>): Promise<number> {
  const igId = getVendorSetting(vendorId, "IG_ACCOUNT_ID");
  if (!igId) return 0;

  const fields = "id,comments.limit(25){id,text,username,timestamp}";
  const url =
    `https://graph.facebook.com/${cfg.fbGraphVersion}/${igId}/media` +
    `?fields=${encodeURIComponent(fields)}&limit=15` +
    `&access_token=${encodeURIComponent(cfg.fbPageAccessToken)}`;

  const res = await fetch(url);
  const data: any = await res.json();
  if (!res.ok || data.error) {
    logger.warn(`[vendor ${vendorId}] IG comment sync: ${data.error?.message ?? res.status}`);
    return 0;
  }

  let synced = 0;
  for (const media of data.data ?? []) {
    const mediaId = String(media.id ?? "");
    for (const c of media.comments?.data ?? []) {
      const commentId = String(c.id ?? "");
      const message = String(c.text ?? "").trim();
      if (!commentId || !message) continue;

      if (isOwnSocialComment(vendorId, cfg, { fromName: c.username ?? null })) continue;

      const exists = db
        .prepare("SELECT id FROM comments WHERE vendor_id = ? AND fb_comment_id = ?")
        .get(vendorId, commentId);
      if (exists) continue;

      await handleIncomingComment(
        vendorId,
        commentId,
        mediaId,
        c.username ?? null,
        message,
        igId
      );
      synced++;
    }
  }
  return synced;
}

/** Poll Page + Instagram posts for new comments when webhooks don't arrive. */
export async function syncVendorComments(vendorId: number): Promise<number> {
  const cfg = getVendorConfig(vendorId);
  if (!vendorFacebookConfigured(cfg)) return 0;

  const fb = await syncFacebookPostComments(vendorId, cfg);
  const ig = await syncInstagramMediaComments(vendorId, cfg);
  const synced = fb + ig;
  if (synced > 0) logger.info(`[vendor ${vendorId}] Synced ${synced} new comment(s) (FB ${fb}, IG ${ig})`);
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
