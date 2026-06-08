import { Router } from "express";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { handleIncomingMessage, handleIncomingComment } from "../services/inbox.js";
import { findVendorByPageId } from "../services/vendor.js";
import { findVendorByChannelKey } from "../services/channels.js";

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

/** Facebook Page + Instagram (unified Meta webhook). */
webhookRouter.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== "page") return;

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
        if (!psid || !text || event.message?.is_echo) continue;
        const channel = event.message?.is_instagram_echo !== undefined || event.sender?.id?.startsWith?.("ig")
          ? "instagram"
          : event.recipient?.id === pageId && event.message?.attachments
            ? "instagram"
            : detectInstagramEvent(event)
              ? "instagram"
              : "messenger";
        await handleIncomingMessage(vendorId, channel, psid, text);
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

function detectInstagramEvent(event: any): boolean {
  return Boolean(event.message?.is_deleted === false && event.message?.mid && event.sender?.id);
}

/** WhatsApp Cloud API webhook. */
webhookRouter.post("/webhook/whatsapp", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    if (body.object !== "whatsapp_business_account") return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") continue;
        const value = change.value ?? {};
        const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
        const vendorId = findVendorByChannelKey("WA_PHONE_NUMBER_ID", phoneNumberId);
        if (!vendorId) {
          logger.warn(`No vendor for WhatsApp phone ${phoneNumberId}`);
          continue;
        }
        for (const msg of value.messages ?? []) {
          if (msg.type !== "text") continue;
          const from = msg.from;
          const text = msg.text?.body;
          const name = value.contacts?.[0]?.profile?.name ?? null;
          if (from && text) await handleIncomingMessage(vendorId, "whatsapp", from, text, name);
        }
      }
    }
  } catch (err) {
    logger.error("WhatsApp webhook error", err);
  }
});

/** Instagram-specific webhook alias (same payload as page). */
webhookRouter.post("/webhook/instagram", async (req, res) => {
  res.sendStatus(200);
  try {
    const body = req.body;
    for (const entry of body.entry ?? []) {
      const igId = String(entry.id ?? "");
      const vendorId = findVendorByChannelKey("IG_ACCOUNT_ID", igId) ?? findVendorByPageId(igId);
      if (!vendorId) continue;
      for (const event of entry.messaging ?? []) {
        const psid = event.sender?.id;
        const text = event.message?.text;
        if (psid && text && !event.message?.is_echo) {
          await handleIncomingMessage(vendorId, "instagram", psid, text);
        }
      }
    }
  } catch (err) {
    logger.error("Instagram webhook error", err);
  }
});
