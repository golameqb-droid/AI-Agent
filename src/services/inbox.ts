import { db } from "../db.js";
import { logger } from "../logger.js";
import { draftMessageReply, draftCommentReply } from "./agent.js";
import { replyToComment, getUserName } from "./facebook.js";
import { getVendorConfig, vendorAiConfigured } from "./vendor.js";
import { getProduct, resolvePublicImageUrl } from "./products.js";
import { detectHandoffRequest, isHandoffActive, setHandoffStatus } from "./handoff.js";
import { parseAiReply } from "./reply-parser.js";
import { createOrderFromAi } from "./orders.js";
import { sendText, sendChannelImage, type Channel, vendorCanUseChannel } from "./channels.js";
import { canUseAi, recordMessageIn, recordMessageOut, recordAiReply } from "./usage.js";
import { isSubscriptionActive } from "./subscription.js";
import type { Conversation } from "../types.js";
import type { VendorConfig } from "./vendor.js";

function upsertConversation(
  vendorId: number,
  channel: Channel,
  psid: string,
  name: string | null
): Conversation {
  const existing = db
    .prepare("SELECT * FROM conversations WHERE vendor_id = ? AND channel = ? AND psid = ?")
    .get(vendorId, channel, psid) as Conversation | undefined;
  if (existing) {
    if (name && !existing.customer_name) {
      db.prepare("UPDATE conversations SET customer_name = ? WHERE id = ?").run(name, existing.id);
      existing.customer_name = name;
    }
    return existing;
  }
  const info = db
    .prepare("INSERT INTO conversations (vendor_id, channel, psid, customer_name) VALUES (?, ?, ?, ?)")
    .run(vendorId, channel, psid, name);
  return db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(info.lastInsertRowid) as Conversation;
}

function recentHistory(conversationId: number, limit = 6) {
  return (
    db
      .prepare(
        "SELECT direction, text FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?"
      )
      .all(conversationId, limit) as { direction: string; text: string }[]
  ).reverse();
}

async function sendProductImages(
  cfg: VendorConfig,
  channel: Channel,
  psid: string,
  convoId: number,
  productIds: number[]
): Promise<void> {
  for (const pid of productIds) {
    const product = getProduct(cfg.vendorId, pid);
    if (!product?.image_url) continue;
    const url = resolvePublicImageUrl(product.image_url);
    if (!url) continue;
    try {
      await sendChannelImage(cfg, channel, psid, url);
      recordMessageOut(cfg.vendorId);
      db.prepare(
        "INSERT INTO messages (conversation_id, direction, text, image_url, status) VALUES (?, 'out', ?, ?, 'sent')"
      ).run(convoId, `[Product image: ${product.name}]`, product.image_url);
    } catch (err) {
      logger.error(`[vendor ${cfg.vendorId}] Failed to send product image ${pid}`, err);
    }
  }
}

async function deliverAiReply(
  cfg: VendorConfig,
  convo: Conversation,
  rawDraft: string,
  customerText: string,
  allowAutoSend = true
): Promise<{ text: string; handoff: boolean }> {
  const channel = (convo.channel ?? "messenger") as Channel;
  const parsed = parseAiReply(rawDraft);
  const handoff = parsed.requestHandoff || detectHandoffRequest(customerText);
  if (handoff) setHandoffStatus(convo.id, "human_requested");

  if (parsed.order) {
    try {
      const order = createOrderFromAi(cfg.vendorId, convo.id, parsed.order, convo.customer_name);
      if (order) {
        setHandoffStatus(convo.id, "human_requested");
        logger.info(`[vendor ${cfg.vendorId}] Order ${order.order_number} created from AI`);
      }
    } catch (err) {
      logger.error(`[vendor ${cfg.vendorId}] Failed to create order from AI`, err);
    }
  }

  if (cfg.autoReplyMessages && allowAutoSend) {
    try {
      if (parsed.text) {
        await sendText(cfg, channel, convo.psid, parsed.text);
        recordMessageOut(cfg.vendorId);
        recordAiReply(cfg.vendorId);
      }
      if (!handoff) await sendProductImages(cfg, channel, convo.psid, convo.id, parsed.productIds);
      db.prepare(
        "INSERT INTO messages (conversation_id, direction, text, status) VALUES (?, 'out', ?, 'sent')"
      ).run(convo.id, parsed.text || "(sent product images)");
      db.prepare(
        "UPDATE conversations SET last_message = ?, unread = 0, updated_at = datetime('now') WHERE id = ?"
      ).run(parsed.text || convo.last_message, convo.id);
      logger.info(`[vendor ${cfg.vendorId}] [${channel}] Auto-replied to ${convo.psid}`);
    } catch (err) {
      logger.error(`[vendor ${cfg.vendorId}] Auto-reply send failed`, err);
    }
  } else {
    db.prepare(
      "INSERT INTO messages (conversation_id, direction, text, ai_draft, status) VALUES (?, 'out', '', ?, 'pending')"
    ).run(convo.id, parsed.text);
    logger.info(`[vendor ${cfg.vendorId}] Draft reply created (awaiting approval)`);
  }

  return { text: parsed.text, handoff };
}

export async function handleIncomingMessage(
  vendorId: number,
  channel: Channel,
  psid: string,
  text: string,
  customerName?: string | null,
  fbMid?: string | null,
  allowAutoSend = true
) {
  if (fbMid) {
    const dup = db.prepare("SELECT id FROM messages WHERE fb_mid = ?").get(fbMid);
    if (dup) return;
  }
  if (!vendorCanUseChannel(vendorId, channel)) {
    logger.warn(`[vendor ${vendorId}] Plan does not include channel ${channel}`);
    return;
  }
  if (!isSubscriptionActive(vendorId)) {
    logger.warn(`[vendor ${vendorId}] Subscription expired`);
    return;
  }

  const cfg = getVendorConfig(vendorId);
  let name = customerName ?? null;
  if (!name && channel === "messenger") {
    try {
      name = await getUserName(cfg, psid);
    } catch {
      /* best-effort */
    }
  }

  const convo = upsertConversation(vendorId, channel, psid, name);
  recordMessageIn(vendorId);
  db.prepare(
    "INSERT INTO messages (conversation_id, direction, text, status, fb_mid) VALUES (?, 'in', ?, 'sent', ?)"
  ).run(convo.id, text, fbMid ?? null);
  db.prepare(
    "UPDATE conversations SET last_message = ?, unread = unread + 1, updated_at = datetime('now') WHERE id = ?"
  ).run(text, convo.id);

  if (detectHandoffRequest(text)) setHandoffStatus(convo.id, "human_requested");
  if (isHandoffActive(convo.id)) {
    logger.info(`[vendor ${vendorId}] Handoff active — AI paused for conversation ${convo.id}`);
    return;
  }

  const usage = canUseAi(vendorId);
  if (!usage.ok) {
    logger.warn(`[vendor ${vendorId}] AI blocked: ${usage.reason}`);
    return;
  }

  if (!vendorAiConfigured(cfg)) {
    logger.warn(`[vendor ${vendorId}] AI not configured — message stored without draft.`);
    return;
  }

  let draft = "";
  try {
    const result = await draftMessageReply(cfg, convo.customer_name, text, recentHistory(convo.id));
    draft = result.text;
  } catch (err) {
    logger.error(`[vendor ${vendorId}] Failed to draft message reply`, err);
    return;
  }

  await deliverAiReply(cfg, convo, draft, text, allowAutoSend);
}

/** Backward-compatible Messenger handler. */
export async function handleIncomingMessenger(vendorId: number, psid: string, text: string) {
  return handleIncomingMessage(vendorId, "messenger", psid, text);
}

export async function handleIncomingComment(
  vendorId: number,
  commentId: string,
  postId: string | null,
  fromName: string | null,
  message: string,
  pageId: string
) {
  const cfg = getVendorConfig(vendorId);
  const existing = db
    .prepare("SELECT id FROM comments WHERE vendor_id = ? AND fb_comment_id = ?")
    .get(vendorId, commentId);
  if (existing) return;

  if (!vendorAiConfigured(cfg)) {
    db.prepare(
      "INSERT INTO comments (vendor_id, fb_comment_id, post_id, from_name, message, status) VALUES (?, ?, ?, ?, ?, 'pending')"
    ).run(vendorId, commentId, postId, fromName, message);
    return;
  }

  let draft = "";
  try {
    const result = await draftCommentReply(cfg, fromName, message);
    draft = result.text;
  } catch (err) {
    logger.error(`[vendor ${vendorId}] Failed to draft comment reply`, err);
  }

  db.prepare(
    "INSERT INTO comments (vendor_id, fb_comment_id, post_id, from_name, message, ai_draft, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')"
  ).run(vendorId, commentId, postId, fromName, message, draft);

  if (cfg.autoReplyComments && draft) {
    try {
      await replyToComment(cfg, commentId, draft);
      db.prepare("UPDATE comments SET status = 'sent' WHERE vendor_id = ? AND fb_comment_id = ?").run(
        vendorId,
        commentId
      );
      logger.info(`[vendor ${vendorId}] Auto-replied to comment ${commentId}`);
    } catch (err) {
      logger.error(`[vendor ${vendorId}] Auto-reply to comment failed`, err);
    }
  }

  void pageId;
}
