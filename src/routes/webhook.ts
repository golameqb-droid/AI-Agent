import { Router } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { handleIncomingMessage, handleIncomingComment } from "../services/inbox.js";

export const webhookRouter = Router();

// Facebook webhook verification (GET) — called once when you set up the webhook.
webhookRouter.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === config.facebook.verifyToken) {
    logger.info("Webhook verified by Facebook.");
    res.status(200).send(challenge);
  } else {
    logger.warn("Webhook verification failed (token mismatch).");
    res.sendStatus(403);
  }
});

// Facebook events (POST) — messages and comments arrive here in real time.
webhookRouter.post("/webhook", async (req, res) => {
  // Always 200 quickly so Facebook does not retry.
  res.sendStatus(200);

  try {
    const body = req.body;
    if (body.object !== "page") return;

    for (const entry of body.entry ?? []) {
      // --- Messenger messages ---
      for (const event of entry.messaging ?? []) {
        const psid = event.sender?.id;
        const text = event.message?.text;
        if (psid && text && !event.message?.is_echo) {
          await handleIncomingMessage(psid, text);
        }
      }

      // --- Feed changes (comments) ---
      for (const change of entry.changes ?? []) {
        if (change.field !== "feed") continue;
        const v = change.value ?? {};
        if (v.item === "comment" && v.verb === "add") {
          // Ignore the page's own comments
          if (v.from?.id && String(v.from.id) === String(config.facebook.pageId)) continue;
          await handleIncomingComment(
            v.comment_id,
            v.post_id ?? null,
            v.from?.name ?? null,
            v.message ?? ""
          );
        }
      }
    }
  } catch (err) {
    logger.error("Error processing webhook event", err);
  }
});
