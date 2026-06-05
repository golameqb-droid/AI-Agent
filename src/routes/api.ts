import { Router } from "express";
import fs from "node:fs";
import { config, aiConfigured, facebookConfigured, applyEnvUpdates } from "../config.js";
import { readEnv, writeEnv, EDITABLE_KEYS } from "../services/envfile.js";
import { db, getSetting, setSetting } from "../db.js";
import { logger } from "../logger.js";
import { draftPost, draftMessageReply, draftCommentReply } from "../services/agent.js";
import {
  sendMessage,
  replyToComment,
  publishPost,
  publishPhoto,
} from "../services/facebook.js";
import { loadKnowledge } from "../services/knowledge.js";
import type { Conversation, PostItem } from "../types.js";

export const apiRouter = Router();

// ----------------------------- Auth -----------------------------
apiRouter.use((req, res, next) => {
  const header = req.headers.authorization ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [user, pass] = Buffer.from(encoded, "base64").toString().split(":");
    if (user === config.dashboard.user && pass === config.dashboard.pass) {
      return next();
    }
  }
  res.set("WWW-Authenticate", 'Basic realm="eQuestionBankBD Agent"');
  res.status(401).json({ error: "Authentication required" });
});

// ---------------------------- Status ----------------------------
apiRouter.get("/status", (_req, res) => {
  res.json({
    ai: {
      configured: aiConfigured(),
      provider: config.ai.provider,
    },
    facebook: {
      configured: facebookConfigured(),
      pageId: config.facebook.pageId || null,
    },
    behaviour: config.behaviour,
  });
});

// --------------------------- Analytics --------------------------
apiRouter.get("/analytics", (_req, res) => {
  const one = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  res.json({
    conversations: one("SELECT COUNT(*) c FROM conversations"),
    pendingMessages: one("SELECT COUNT(*) c FROM messages WHERE status='pending'"),
    pendingComments: one("SELECT COUNT(*) c FROM comments WHERE status='pending'"),
    sentMessages: one("SELECT COUNT(*) c FROM messages WHERE direction='out' AND status='sent'"),
    sentComments: one("SELECT COUNT(*) c FROM comments WHERE status='sent'"),
    publishedPosts: one("SELECT COUNT(*) c FROM posts WHERE status='published'"),
    scheduledPosts: one("SELECT COUNT(*) c FROM posts WHERE status='scheduled'"),
    drafts: one("SELECT COUNT(*) c FROM posts WHERE status='draft'"),
  });
});

// -------------------------- Conversations -----------------------
apiRouter.get("/conversations", (_req, res) => {
  const rows = db
    .prepare("SELECT * FROM conversations ORDER BY updated_at DESC LIMIT 100")
    .all() as Conversation[];
  res.json(rows);
});

apiRouter.get("/conversations/:id/messages", (req, res) => {
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC")
    .all(req.params.id);
  db.prepare("UPDATE conversations SET unread = 0 WHERE id = ?").run(req.params.id);
  res.json(rows);
});

// Approve / edit + send a drafted Messenger reply
apiRouter.post("/messages/:id/send", async (req, res) => {
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(msg.conversation_id) as Conversation;

  const text = (req.body?.text ?? msg.ai_draft ?? "").toString().trim();
  if (!text) return res.status(400).json({ error: "Empty reply" });

  try {
    await sendMessage(convo.psid, text);
    db.prepare("UPDATE messages SET text = ?, status = 'sent' WHERE id = ?").run(
      text,
      msg.id
    );
    db.prepare(
      "UPDATE conversations SET last_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(text, convo.id);
    res.json({ ok: true });
  } catch (err: any) {
    logger.error("Send message failed", err);
    res.status(500).json({ error: err.message });
  }
});

// Send a brand-new manual message in a conversation
apiRouter.post("/conversations/:id/reply", async (req, res) => {
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(req.params.id) as Conversation | undefined;
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const text = (req.body?.text ?? "").toString().trim();
  if (!text) return res.status(400).json({ error: "Empty reply" });

  try {
    await sendMessage(convo.psid, text);
    db.prepare(
      "INSERT INTO messages (conversation_id, direction, text, status) VALUES (?, 'out', ?, 'sent')"
    ).run(convo.id, text);
    db.prepare(
      "UPDATE conversations SET last_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(text, convo.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/messages/:id/ignore", (req, res) => {
  db.prepare("UPDATE messages SET status = 'ignored' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// Regenerate an AI draft for a message
apiRouter.post("/messages/:id/regenerate", async (req, res) => {
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ?")
    .get(msg.conversation_id) as Conversation;
  const lastIn = db
    .prepare(
      "SELECT text FROM messages WHERE conversation_id = ? AND direction='in' ORDER BY id DESC LIMIT 1"
    )
    .get(convo.id) as { text: string } | undefined;
  try {
    const result = await draftMessageReply(convo.customer_name, lastIn?.text ?? "");
    db.prepare("UPDATE messages SET ai_draft = ? WHERE id = ?").run(result.text, msg.id);
    res.json({ draft: result.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------- Comments --------------------------
apiRouter.get("/comments", (req, res) => {
  const status = req.query.status;
  const rows = status
    ? db.prepare("SELECT * FROM comments WHERE status = ? ORDER BY id DESC").all(status)
    : db.prepare("SELECT * FROM comments ORDER BY id DESC LIMIT 200").all();
  res.json(rows);
});

apiRouter.post("/comments/:id/send", async (req, res) => {
  const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.id) as any;
  if (!c) return res.status(404).json({ error: "Comment not found" });
  const text = (req.body?.text ?? c.ai_draft ?? "").toString().trim();
  if (!text) return res.status(400).json({ error: "Empty reply" });
  try {
    await replyToComment(c.fb_comment_id, text);
    db.prepare("UPDATE comments SET ai_draft = ?, status = 'sent' WHERE id = ?").run(
      text,
      c.id
    );
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/comments/:id/ignore", (req, res) => {
  db.prepare("UPDATE comments SET status = 'ignored' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

apiRouter.post("/comments/:id/regenerate", async (req, res) => {
  const c = db.prepare("SELECT * FROM comments WHERE id = ?").get(req.params.id) as any;
  if (!c) return res.status(404).json({ error: "Comment not found" });
  try {
    const result = await draftCommentReply(c.from_name, c.message);
    db.prepare("UPDATE comments SET ai_draft = ? WHERE id = ?").run(result.text, c.id);
    res.json({ draft: result.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------- Posts ----------------------------
apiRouter.get("/posts", (_req, res) => {
  res.json(db.prepare("SELECT * FROM posts ORDER BY id DESC LIMIT 100").all());
});

// AI: generate post content from a topic
apiRouter.post("/posts/generate", async (req, res) => {
  const topic = (req.body?.topic ?? "").toString().trim();
  if (!topic) return res.status(400).json({ error: "Topic is required" });
  try {
    const result = await draftPost(topic);
    res.json({ text: result.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save a post as draft or scheduled
apiRouter.post("/posts", (req, res) => {
  const { message, image_url, link, scheduled_at } = req.body ?? {};
  if (!message || !message.toString().trim())
    return res.status(400).json({ error: "Post text is required" });
  const status = scheduled_at ? "scheduled" : "draft";
  const info = db
    .prepare(
      "INSERT INTO posts (message, image_url, link, status, scheduled_at) VALUES (?, ?, ?, ?, ?)"
    )
    .run(
      message.toString(),
      image_url?.toString() || null,
      link?.toString() || null,
      status,
      scheduled_at?.toString() || null
    );
  res.json(db.prepare("SELECT * FROM posts WHERE id = ?").get(info.lastInsertRowid));
});

// Publish a saved post (or publish immediately)
apiRouter.post("/posts/:id/publish", async (req, res) => {
  const post = db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id) as
    | PostItem
    | undefined;
  if (!post) return res.status(404).json({ error: "Post not found" });
  try {
    let result: any;
    if (post.image_url) {
      result = await publishPhoto(post.image_url, post.message);
    } else {
      result = await publishPost(post.message, post.link);
    }
    const fbId = result.post_id ?? result.id ?? null;
    db.prepare(
      "UPDATE posts SET status = 'published', fb_post_id = ?, error = NULL WHERE id = ?"
    ).run(fbId, post.id);
    res.json({ ok: true, fb_post_id: fbId });
  } catch (err: any) {
    db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(
      err.message,
      post.id
    );
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete("/posts/:id", (req, res) => {
  db.prepare("DELETE FROM posts WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// --------------------------- Knowledge --------------------------
apiRouter.get("/knowledge", (_req, res) => {
  res.json({ content: loadKnowledge() });
});

apiRouter.put("/knowledge", (req, res) => {
  const content = (req.body?.content ?? "").toString();
  try {
    fs.writeFileSync(config.paths.knowledge, content, "utf8");
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------- Configuration (.env) --------------------
// Secret keys are masked in responses; an empty/blank value on save = "keep current".
const SECRET_KEYS = new Set(["DASHBOARD_PASS", "GEMINI_API_KEY", "GROQ_API_KEY", "FB_PAGE_ACCESS_TOKEN"]);

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

apiRouter.get("/config", (_req, res) => {
  const values = readEnv();
  const masked: Record<string, string> = {};
  const isSet: Record<string, boolean> = {};
  for (const key of EDITABLE_KEYS) {
    const v = values[key] ?? "";
    isSet[key] = Boolean(v);
    masked[key] = SECRET_KEYS.has(key) ? maskValue(v) : v;
  }
  res.json({ values: masked, isSet, secretKeys: [...SECRET_KEYS] });
});

apiRouter.put("/config", (req, res) => {
  const incoming = (req.body?.values ?? {}) as Record<string, string>;
  const current = readEnv();
  const updates: Record<string, string> = {};

  for (const key of EDITABLE_KEYS) {
    if (!(key in incoming)) continue;
    const val = (incoming[key] ?? "").toString();
    // For secrets, a blank or masked value means "keep existing".
    if (SECRET_KEYS.has(key) && (val === "" || val.startsWith("••••"))) continue;
    updates[key] = val;
  }

  try {
    writeEnv(updates);
    applyEnvUpdates(updates);
    // Keep DB-backed runtime overrides in sync with behaviour changes.
    if (updates.AUTO_REPLY_MESSAGES !== undefined)
      setSetting("autoReplyMessages", String(config.behaviour.autoReplyMessages));
    if (updates.AUTO_REPLY_COMMENTS !== undefined)
      setSetting("autoReplyComments", String(config.behaviour.autoReplyComments));
    if (updates.REPLY_LANGUAGE !== undefined)
      setSetting("replyLanguage", config.behaviour.replyLanguage);

    const portChanged = "PORT" in updates && updates.PORT !== String(config.port);
    res.json({ ok: true, restartRequired: portChanged });
  } catch (err: any) {
    logger.error("Failed to save config", err);
    res.status(500).json({ error: err.message });
  }
  void current;
});

// --------------------------- Settings ---------------------------
apiRouter.get("/settings", (_req, res) => {
  res.json({
    autoReplyMessages: config.behaviour.autoReplyMessages,
    autoReplyComments: config.behaviour.autoReplyComments,
    replyLanguage: config.behaviour.replyLanguage,
    // runtime overrides persisted in DB (take effect without restart)
    overrides: {
      autoReplyMessages: getSetting("autoReplyMessages"),
      autoReplyComments: getSetting("autoReplyComments"),
    },
  });
});

apiRouter.put("/settings", (req, res) => {
  const { autoReplyMessages, autoReplyComments, replyLanguage } = req.body ?? {};
  if (autoReplyMessages !== undefined) {
    config.behaviour.autoReplyMessages = Boolean(autoReplyMessages);
    setSetting("autoReplyMessages", String(Boolean(autoReplyMessages)));
  }
  if (autoReplyComments !== undefined) {
    config.behaviour.autoReplyComments = Boolean(autoReplyComments);
    setSetting("autoReplyComments", String(Boolean(autoReplyComments)));
  }
  if (replyLanguage) {
    config.behaviour.replyLanguage = String(replyLanguage).toLowerCase();
    setSetting("replyLanguage", config.behaviour.replyLanguage);
  }
  res.json({ ok: true });
});
