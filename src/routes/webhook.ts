import { Router } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { handleIncomingMessage, handleIncomingComment } from "../services/inbox.js";
import { findVendorByPageId } from "../services/vendor.js";
import { findVendorByChannelKey } from "../services/channels.js";
import { processWhatsAppWebhook } from "../services/whatsapp-webhook.js";

export const webhookRouter = Router();

function verifyWebhook(req: any, res: any): boolean | void {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === config.platform.webhookVerifyToken) {
    logger.info("Webhook verified.");
    res.status(200).send(challenge);
    return true;
  }
  res.sendStatus(403);
  return false;
}

webhookRouter.get("/webhook", verifyWebhook);
webhookRouter.get("/webhook/whatsapp", verifyWebhook);
webhookRouter.get("/webhook/instagram", verifyWebhook);

async function processInstagramWebhook(body: any): Promise<void> {
  let msgCount = 0;
  let commentCount = 0;

  for (const entry of body.entry ?? []) {
    const igId = String(entry.id ?? "");
    const vendorId = findVendorByChannelKey("IG_ACCOUNT_ID", igId) ?? findVendorByPageId(igId);
    if (!vendorId) {
      logger.warn(`No vendor for Instagram account ${igId}`);
      continue;
    }

    for (const event of entry.messaging ?? []) {
      const psid = event.sender?.id;
      const text = event.message?.text;
      const mid = event.message?.mid?.toString();
      if (!psid || !text || event.message?.is_echo) continue;
      msgCount++;
      logger.info(`Instagram DM from ${psid} on account ${igId}`);
      await handleIncomingMessage(vendorId, "instagram", psid, text, undefined, mid);
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const v = change.value ?? {};
      const commentId = String(v.comment_id ?? v.id ?? "");
      const text = String(v.text ?? "").trim();
      if (!commentId || !text) continue;
      commentCount++;
      const fromId = v.from?.id ? String(v.from.id) : null;
      const fromName = v.from?.username ?? v.from?.name ?? null;
      const mediaId = v.media?.id ? String(v.media.id) : null;
      logger.info(`Instagram comment from ${fromName ?? fromId ?? "unknown"} on media ${mediaId ?? "?"}`);
      await handleIncomingComment(vendorId, commentId, mediaId, fromName, text, igId, fromId);
    }
  }

  if (msgCount) logger.info(`Webhook instagram event: ${msgCount} message(s)`);
  if (commentCount) logger.info(`Webhook instagram event: ${commentCount} comment(s)`);
}

/** Facebook Page + Instagram (unified Meta webhook). */
webhookRouter.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object === "whatsapp_business_account") {
      await processWhatsAppWebhook(body);
      return;
    }
    if (body.object === "instagram") {
      await processInstagramWebhook(body);
      return;
    }
    if (body.object !== "page") {
      logger.warn(`Webhook ignored: unknown object "${body.object ?? ""}"`);
      return;
    }

    const msgCount = (body.entry ?? []).reduce(
      (n: number, e: any) => n + (e.messaging?.length ?? 0),
      0
    );
    const changeCount = (body.entry ?? []).reduce(
      (n: number, e: any) => n + (e.changes?.length ?? 0),
      0
    );
    if (msgCount || changeCount) {
      logger.info(`Webhook page event: ${msgCount} message(s), ${changeCount} change(s)`);
    }

    for (const entry of body.entry ?? []) {
      const pageId = String(entry.id ?? "");
      const vendorId = findVendorByPageId(pageId);
      if (!vendorId) {
        logger.warn(`No vendor for page ${pageId}`);
        continue;
      }

      for (const event of entry.messaging ?? []) {
        const psid = event.sender?.id;
        const text = event.message?.text;
        const mid = event.message?.mid?.toString();
        if (!psid || !text || event.message?.is_echo) continue;
        const channel = detectMessageChannel(event, pageId);
        if (channel === "instagram") {
          logger.info(`Instagram DM from ${psid} on page ${pageId}`);
        }
        await handleIncomingMessage(vendorId, channel, psid, text, undefined, mid);
      }

      for (const change of entry.changes ?? []) {
        if (change.field !== "feed") continue;
        const v = change.value ?? {};
        logger.info(`Feed webhook page ${pageId}: item=${v.item} verb=${v.verb}`);
        if (v.item === "comment" && (v.verb === "add" || v.verb === "edited")) {
          if (v.from?.id && String(v.from.id) === pageId) continue;
          await handleIncomingComment(
            vendorId,
            v.comment_id,
            v.post_id ?? null,
            v.from?.name ?? null,
            v.message ?? "",
            pageId
          );
        }
      }
    }
  } catch (err) {
    logger.error("Webhook processing error", err);
  }
});

/** Instagram DMs arrive on the Page webhook; recipient is usually the IG business account id. */
function detectMessageChannel(event: any, pageId: string): "instagram" | "messenger" {
  if (event.messaging_product === "instagram") return "instagram";
  if (event.message?.is_instagram_echo !== undefined) return "instagram";

  const recipientId = String(event.recipient?.id ?? "");
  const senderId = String(event.sender?.id ?? "");

  if (findVendorByChannelKey("IG_ACCOUNT_ID", recipientId)) return "instagram";
  if (findVendorByChannelKey("IG_ACCOUNT_ID", senderId)) return "instagram";

  return "messenger";
}

/** WhatsApp Cloud API webhook (dedicated URL — same handler as /webhook). */
webhookRouter.post("/webhook/whatsapp", async (req, res) => {
  res.sendStatus(200);
  try {
    await processWhatsAppWebhook(req.body);
  } catch (err) {
    logger.error("WhatsApp webhook error", err);
  }
});

/** Instagram-specific webhook alias (object: instagram). */
webhookRouter.post("/webhook/instagram", async (req, res) => {
  res.sendStatus(200);
  try {
    await processInstagramWebhook(req.body);
  } catch (err) {
    logger.error("Instagram webhook error", err);
  }
});
