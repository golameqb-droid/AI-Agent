import { db } from "../db.js";
import { config, aiConfigured } from "../config.js";
import { logger } from "../logger.js";
import { draftMessageReply, draftCommentReply } from "./agent.js";
import { sendMessage, replyToComment, getUserName } from "./facebook.js";
import type { Conversation, Message } from "../types.js";

/** Find or create a conversation row for a Messenger user. */
function upsertConversation(psid: string, name: string | null): Conversation {
  const existing = db
    .prepare("SELECT * FROM conversations WHERE psid = ?")
    .get(psid) as Conversation | undefined;
  if (existing) {
    if (name && !existing.customer_name) {
      db.prepare("UPDATE conversations SET customer_name = ? WHERE id = ?").run(
        name,
        existing.id
      );
      existing.customer_name = name;
    }
    return existing;
  }
  const info = db
    .prepare("INSERT INTO conversations (psid, customer_name) VALUES (?, ?)")
    .run(psid, name);
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

/** Handle an incoming Messenger message from the webhook. */
export async function handleIncomingMessage(psid: string, text: string) {
  let name: string | null = null;
  try {
    name = await getUserName(psid);
  } catch {
    /* best-effort */
  }

  const convo = upsertConversation(psid, name);

  db.prepare(
    "INSERT INTO messages (conversation_id, direction, text, status) VALUES (?, 'in', ?, 'sent')"
  ).run(convo.id, text);
  db.prepare(
    "UPDATE conversations SET last_message = ?, unread = unread + 1, updated_at = datetime('now') WHERE id = ?"
  ).run(text, convo.id);

  if (!aiConfigured()) {
    logger.warn("AI not configured — message stored without a draft.");
    return;
  }

  let draft = "";
  try {
    const history = recentHistory(convo.id);
    const result = await draftMessageReply(convo.customer_name, text, history);
    draft = result.text;
  } catch (err) {
    logger.error("Failed to draft message reply", err);
    return;
  }

  if (config.behaviour.autoReplyMessages) {
    try {
      await sendMessage(psid, draft);
      db.prepare(
        "INSERT INTO messages (conversation_id, direction, text, status) VALUES (?, 'out', ?, 'sent')"
      ).run(convo.id, draft);
      db.prepare(
        "UPDATE conversations SET last_message = ?, unread = 0, updated_at = datetime('now') WHERE id = ?"
      ).run(draft, convo.id);
      logger.info(`Auto-replied to ${psid}`);
    } catch (err) {
      logger.error("Auto-reply send failed", err);
    }
  } else {
    db.prepare(
      "INSERT INTO messages (conversation_id, direction, text, ai_draft, status) VALUES (?, 'out', '', ?, 'pending')"
    ).run(convo.id, draft);
    logger.info(`Draft reply created for ${psid} (awaiting approval)`);
  }
}

/** Handle a new comment on a page post from the webhook. */
export async function handleIncomingComment(
  commentId: string,
  postId: string | null,
  fromName: string | null,
  message: string
) {
  const existing = db
    .prepare("SELECT id FROM comments WHERE fb_comment_id = ?")
    .get(commentId);
  if (existing) return;

  if (!aiConfigured()) {
    db.prepare(
      "INSERT INTO comments (fb_comment_id, post_id, from_name, message, status) VALUES (?, ?, ?, ?, 'pending')"
    ).run(commentId, postId, fromName, message);
    return;
  }

  let draft = "";
  try {
    const result = await draftCommentReply(fromName, message);
    draft = result.text;
  } catch (err) {
    logger.error("Failed to draft comment reply", err);
  }

  db.prepare(
    "INSERT INTO comments (fb_comment_id, post_id, from_name, message, ai_draft, status) VALUES (?, ?, ?, ?, ?, 'pending')"
  ).run(commentId, postId, fromName, message, draft);

  if (config.behaviour.autoReplyComments && draft) {
    try {
      await replyToComment(commentId, draft);
      db.prepare(
        "UPDATE comments SET status = 'sent' WHERE fb_comment_id = ?"
      ).run(commentId);
      logger.info(`Auto-replied to comment ${commentId}`);
    } catch (err) {
      logger.error("Auto-reply to comment failed", err);
    }
  }
}

export type { Message };
