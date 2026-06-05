import cron from "node-cron";
import { db } from "./db.js";
import { logger } from "./logger.js";
import { publishPost, publishPhoto } from "./services/facebook.js";
import type { PostItem } from "./types.js";

/** Every minute, publish any scheduled posts whose time has arrived. */
export function startScheduler() {
  cron.schedule("* * * * *", async () => {
    const due = db
      .prepare(
        "SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= datetime('now')"
      )
      .all() as PostItem[];

    for (const post of due) {
      try {
        const result: any = post.image_url
          ? await publishPhoto(post.image_url, post.message)
          : await publishPost(post.message, post.link);
        const fbId = result.post_id ?? result.id ?? null;
        db.prepare(
          "UPDATE posts SET status = 'published', fb_post_id = ?, error = NULL WHERE id = ?"
        ).run(fbId, post.id);
        logger.info(`Scheduled post #${post.id} published (${fbId}).`);
      } catch (err: any) {
        db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(
          err.message,
          post.id
        );
        logger.error(`Scheduled post #${post.id} failed`, err);
      }
    }
  });

  logger.info("Post scheduler started (checks every minute).");
}
