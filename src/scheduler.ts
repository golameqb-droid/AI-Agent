import cron from "node-cron";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { publishPost, publishPhoto } from "./services/facebook.js";
import { syncAllVendorComments } from "./services/comment-sync.js";
import { syncAllVendorMessages } from "./services/message-sync.js";
import { getVendorConfig } from "./services/vendor.js";
import { processFollowUpQueue, scanStaleConversations } from "./services/follow-up.js";
import { scanAbandonedCarts } from "./services/cart-intents.js";
import type { PostItem } from "./types.js";

export function startScheduler() {
  cron.schedule("* * * * *", async () => {
    const due = db
      .prepare(
        "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')"
      )
      .all() as PostItem[];

    for (const post of due) {
      const cfg = getVendorConfig(post.vendor_id);
      try {
        const result: any = post.image_url
          ? await publishPhoto(cfg, post.image_url, post.message)
          : await publishPost(cfg, post.message, post.link);
        const fbId = result.post_id ?? result.id ?? null;
        db.prepare(
          "UPDATE posts SET status = 'published', fb_post_id = ?, error = NULL WHERE id = ?"
        ).run(fbId, post.id);
        logger.info(`[vendor ${post.vendor_id}] Scheduled post #${post.id} published.`);
      } catch (err: any) {
        db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(
          err.message,
          post.id
        );
        logger.error(`[vendor ${post.vendor_id}] Scheduled post #${post.id} failed`, err);
      }
    }
  });

  cron.schedule("* * * * *", () => {
    void syncAllVendorComments();
    void syncAllVendorMessages();
  });

  cron.schedule("*/15 * * * *", async () => {
    try {
      await processFollowUpQueue();
      const vendors = db.prepare("SELECT id FROM vendors WHERE status IN ('active','trial')").all() as {
        id: number;
      }[];
      for (const v of vendors) {
        scanStaleConversations(v.id);
        scanAbandonedCarts(v.id);
      }
    } catch (err) {
      logger.error("CRM scheduler tick failed", err);
    }
  });

  logger.info("Post scheduler started (checks every minute).");
  void syncAllVendorComments();
  void syncAllVendorMessages();
}
