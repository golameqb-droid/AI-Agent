import { Router } from "express";
import { db } from "../db.js";
import { logger } from "../logger.js";
import { requireAuth, requireVendor, type AuthedRequest } from "../middleware/auth.js";
import { productImageUpload } from "../middleware/upload.js";
import { draftPost, draftMessageReply, draftCommentReply } from "../services/agent.js";
import { replyToComment, publishPost, publishPhoto } from "../services/facebook.js";
import { sendText, channelConfigured } from "../services/channels.js";
import { getMonthlyUsage, canUseAi } from "../services/usage.js";
import { getSubscription } from "../services/subscription.js";
import { getPlan, planAllowsChannel } from "../services/plans.js";
import { listTemplates, createTemplate, deleteTemplate } from "../services/post-templates.js";
import {
  getVendorConfig,
  vendorFacebookConfigured,
  setVendorSettings,
  VENDOR_ADMIN_KEYS,
  SECRET_VENDOR_KEYS,
  getVendorSetting,
  getVendorById,
} from "../services/vendor.js";
import { platformAiConfigured } from "../services/platform.js";
import { loadVendorKnowledge, saveVendorKnowledge } from "../services/knowledge.js";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../services/products.js";
import { getVendorKpis } from "../services/kpis.js";
import { vendorKpisToCsv, vendorKpiReportHtml } from "../services/kpi-export.js";
import { setHandoffStatus, countHandoffQueue } from "../services/handoff.js";
import {
  listOrders,
  getOrder,
  createOrder,
  updateOrderStatus,
  countPendingOrders,
  ordersToCsv,
  orderToPublic,
} from "../services/orders.js";
import type { Conversation, PostItem, HandoffStatus, OrderStatus } from "../types.js";

export const apiRouter = Router();
apiRouter.use(requireAuth, requireVendor);

function vendorId(req: AuthedRequest): number {
  return req.user!.vendorId!;
}

function count(sql: string, vid: number) {
  return (db.prepare(sql).get(vid) as { c: number }).c;
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

// ---------------------------- Status ----------------------------
apiRouter.get("/status", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const usage = canUseAi(vid);
  const sub = getSubscription(vid);
  const plan = sub?.plan ?? "trial";
  const channels = {
    messenger: channelConfigured(cfg, "messenger"),
    whatsapp: channelConfigured(cfg, "whatsapp"),
    instagram: channelConfigured(cfg, "instagram"),
  };
  res.json({
    ai: { configured: platformAiConfigured(), provider: cfg.aiProvider },
    facebook: { configured: vendorFacebookConfigured(cfg), pageId: cfg.fbPageId || null },
    channels,
    plan,
    planChannels: getPlan(plan).channels,
    usage: { used: usage.used, limit: usage.limit },
    ready:
      platformAiConfigured() &&
      (channels.messenger || channels.whatsapp || channels.instagram),
  });
});

// ----------------------- Vendor channel settings ----------------
apiRouter.get("/settings", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const vendor = getVendorById(vid);
  const cfg = getVendorConfig(vid);
  const sub = getSubscription(vid);
  const plan = sub?.plan ?? "trial";
  const masked: Record<string, string> = {};
  const map: Record<string, string> = {
    FB_PAGE_ID: cfg.fbPageId,
    FB_PAGE_ACCESS_TOKEN: cfg.fbPageAccessToken,
    FB_GRAPH_VERSION: cfg.fbGraphVersion,
    WA_PHONE_NUMBER_ID: getVendorSetting(vid, "WA_PHONE_NUMBER_ID") ?? "",
    WA_ACCESS_TOKEN: getVendorSetting(vid, "WA_ACCESS_TOKEN") ?? "",
    IG_ACCOUNT_ID: getVendorSetting(vid, "IG_ACCOUNT_ID") ?? "",
    AUTO_REPLY_MESSAGES: String(cfg.autoReplyMessages),
    AUTO_REPLY_COMMENTS: String(cfg.autoReplyComments),
    REPLY_LANGUAGE: cfg.replyLanguage,
  };
  for (const key of VENDOR_ADMIN_KEYS) {
    const v = map[key] ?? "";
    masked[key] = SECRET_VENDOR_KEYS.has(key) ? maskValue(v) : v;
  }
  res.json({
    vendor,
    values: masked,
    secretKeys: [...SECRET_VENDOR_KEYS],
    channels: {
      messenger: {
        configured: channelConfigured(cfg, "messenger"),
        allowed: planAllowsChannel(plan, "messenger"),
      },
      whatsapp: {
        configured: channelConfigured(cfg, "whatsapp"),
        allowed: planAllowsChannel(plan, "whatsapp"),
      },
      instagram: {
        configured: channelConfigured(cfg, "instagram"),
        allowed: planAllowsChannel(plan, "instagram"),
      },
    },
    webhooks: {
      messenger: "/webhook",
      whatsapp: "/webhook/whatsapp",
      instagram: "/webhook/instagram",
    },
  });
});

apiRouter.put("/settings", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const incoming = (req.body?.values ?? {}) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const key of VENDOR_ADMIN_KEYS) {
    if (!(key in incoming)) continue;
    const val = (incoming[key] ?? "").toString();
    if (SECRET_VENDOR_KEYS.has(key) && (val === "" || val.startsWith("••••"))) continue;
    updates[key] = val;
  }
  setVendorSettings(vid, updates);
  res.json({ ok: true });
});

// ----------------------- Vendor knowledge base ------------------
apiRouter.get("/knowledge", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  res.json({ content: loadVendorKnowledge(vid) });
});

apiRouter.put("/knowledge", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  saveVendorKnowledge(vid, (req.body?.content ?? "").toString());
  res.json({ ok: true });
});

// ----------------------- Vendor product catalog -----------------
apiRouter.get("/products", (req: AuthedRequest, res) => {
  res.json(listProducts(vendorId(req)));
});

apiRouter.post("/products", productImageUpload.single("image"), (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const { name, description, price, link } = req.body ?? {};
  if (!name?.toString().trim()) return res.status(400).json({ error: "Product name required" });
  const imageUrl = req.file ? `/uploads/${vid}/${req.file.filename}` : null;
  const product = createProduct(vid, {
    name: String(name),
    description: description ? String(description) : undefined,
    price: price ? String(price) : undefined,
    link: link ? String(link) : undefined,
    image_url: imageUrl ?? undefined,
  });
  res.json(product);
});

apiRouter.put("/products/:id", productImageUpload.single("image"), (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const pid = Number(req.params.id);
  const { name, description, price, link, active } = req.body ?? {};
  const data: Record<string, string | number> = {};
  if (name !== undefined) data.name = String(name);
  if (description !== undefined) data.description = String(description);
  if (price !== undefined) data.price = String(price);
  if (link !== undefined) data.link = String(link);
  if (active !== undefined) data.active = active === "true" || active === true || active === 1 ? 1 : 0;
  if (req.file) data.image_url = `/uploads/${vid}/${req.file.filename}`;
  const product = updateProduct(vid, pid, data);
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json(product);
});

apiRouter.delete("/products/:id", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const pid = Number(req.params.id);
  if (!deleteProduct(vid, pid)) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

apiRouter.get("/usage", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const u = getMonthlyUsage(vid);
  const limit = canUseAi(vid).limit;
  const sub = getSubscription(vid);
  res.json({
    month: u.month,
    messagesIn: u.messages_in,
    messagesOut: u.messages_out,
    aiReplies: u.ai_replies,
    limit,
    plan: getPlan(sub?.plan ?? "trial"),
    subscription: sub ?? null,
  });
});

// ----------------------------- KPIs -----------------------------
apiRouter.get("/kpis", (req: AuthedRequest, res) => {
  res.json(getVendorKpis(vendorId(req)));
});

apiRouter.get("/kpis/export.csv", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kpi-vendor-${vid}.csv"`);
  res.send(vendorKpisToCsv(vid));
});

apiRouter.get("/kpis/report", (req: AuthedRequest, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(vendorKpiReportHtml(vendorId(req)));
});

// --------------------------- Analytics --------------------------
apiRouter.get("/analytics", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  res.json({
    conversations: count("SELECT COUNT(*) c FROM conversations WHERE vendor_id = ?", vid),
    pendingMessages: count(
      "SELECT COUNT(*) c FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.vendor_id=? AND m.status='pending'",
      vid
    ),
    pendingComments: count("SELECT COUNT(*) c FROM comments WHERE vendor_id=? AND status='pending'", vid),
    sentMessages: count(
      "SELECT COUNT(*) c FROM messages m JOIN conversations c ON c.id=m.conversation_id WHERE c.vendor_id=? AND m.direction='out' AND m.status='sent'",
      vid
    ),
    sentComments: count("SELECT COUNT(*) c FROM comments WHERE vendor_id=? AND status='sent'", vid),
    publishedPosts: count("SELECT COUNT(*) c FROM posts WHERE vendor_id=? AND status='published'", vid),
    scheduledPosts: count("SELECT COUNT(*) c FROM posts WHERE vendor_id=? AND status='scheduled'", vid),
    drafts: count("SELECT COUNT(*) c FROM posts WHERE vendor_id=? AND status='draft'", vid),
    handoffQueue: countHandoffQueue(vid),
    pendingOrders: countPendingOrders(vid),
  });
});

// -------------------------- Conversations -----------------------
apiRouter.get("/conversations", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  try {
    const { syncVendorMessages } = await import("../services/message-sync.js");
    await syncVendorMessages(vid);
  } catch {
    /* sync is best-effort */
  }
  const channel = req.query.channel?.toString();
  const rows = channel
    ? (db
        .prepare("SELECT * FROM conversations WHERE vendor_id = ? AND channel = ? ORDER BY updated_at DESC LIMIT 100")
        .all(vid, channel) as Conversation[])
    : (db
        .prepare("SELECT * FROM conversations WHERE vendor_id = ? ORDER BY updated_at DESC LIMIT 100")
        .all(vid) as Conversation[]);
  res.json(rows);
});

apiRouter.get("/conversations/:id/messages", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, vid);
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const rows = db
    .prepare("SELECT * FROM messages WHERE conversation_id = ? ORDER BY id ASC")
    .all(req.params.id);
  db.prepare("UPDATE conversations SET unread = 0 WHERE id = ?").run(req.params.id);
  res.json(rows);
});

apiRouter.post("/messages/:id/send", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ? AND vendor_id = ?")
    .get(msg.conversation_id, vid) as Conversation | undefined;
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const text = (req.body?.text ?? msg.ai_draft ?? "").toString().trim();
  if (!text) return res.status(400).json({ error: "Empty reply" });
  try {
    await sendText(cfg, convo.channel ?? "messenger", convo.psid, text);
    db.prepare("UPDATE messages SET text = ?, status = 'sent' WHERE id = ?").run(text, msg.id);
    db.prepare(
      "UPDATE conversations SET last_message = ?, updated_at = datetime('now') WHERE id = ?"
    ).run(text, convo.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/conversations/:id/reply", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, vid) as Conversation | undefined;
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const text = (req.body?.text ?? "").toString().trim();
  if (!text) return res.status(400).json({ error: "Empty reply" });
  try {
    await sendText(cfg, convo.channel ?? "messenger", convo.psid, text);
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

apiRouter.post("/messages/:id/ignore", (req: AuthedRequest, res) => {
  db.prepare("UPDATE messages SET status = 'ignored' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

apiRouter.post("/conversations/:id/handoff", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, vid) as Conversation | undefined;
  if (!convo) return res.status(404).json({ error: "Conversation not found" });
  const action = (req.body?.action ?? "").toString();
  const map: Record<string, HandoffStatus> = {
    take_over: "human_active",
    release: "ai",
    request: "human_requested",
  };
  const status = map[action];
  if (!status) return res.status(400).json({ error: "action must be take_over, release, or request" });
  setHandoffStatus(convo.id, status);
  res.json({ ok: true, handoff_status: status });
});

apiRouter.post("/messages/:id/regenerate", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const msg = db.prepare("SELECT * FROM messages WHERE id = ?").get(req.params.id) as any;
  if (!msg) return res.status(404).json({ error: "Message not found" });
  const convo = db
    .prepare("SELECT * FROM conversations WHERE id = ? AND vendor_id = ?")
    .get(msg.conversation_id, vid) as Conversation;
  const lastIn = db
    .prepare(
      "SELECT text FROM messages WHERE conversation_id = ? AND direction='in' ORDER BY id DESC LIMIT 1"
    )
    .get(convo.id) as { text: string } | undefined;
  try {
    const result = await draftMessageReply(cfg, convo.customer_name, lastIn?.text ?? "");
    db.prepare("UPDATE messages SET ai_draft = ? WHERE id = ?").run(result.text, msg.id);
    res.json({ draft: result.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---------------------------- Comments --------------------------
apiRouter.get("/comments", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  try {
    const { syncVendorComments } = await import("../services/comment-sync.js");
    await syncVendorComments(vid);
  } catch {
    /* sync is best-effort */
  }
  const status = req.query.status;
  const rows = status
    ? db.prepare("SELECT * FROM comments WHERE vendor_id = ? AND status = ? ORDER BY id DESC").all(vid, status)
    : db.prepare("SELECT * FROM comments WHERE vendor_id = ? ORDER BY id DESC LIMIT 200").all(vid);
  res.json(rows);
});

apiRouter.post("/comments/:id/send", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const c = db
    .prepare("SELECT * FROM comments WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, vid) as any;
  if (!c) return res.status(404).json({ error: "Comment not found" });
  const text = (req.body?.text ?? c.ai_draft ?? "").toString().trim();
  if (!text) return res.status(400).json({ error: "Empty reply" });
  try {
    await replyToComment(cfg, c.fb_comment_id, text);
    db.prepare("UPDATE comments SET ai_draft = ?, status = 'sent' WHERE id = ?").run(text, c.id);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/comments/:id/ignore", (req: AuthedRequest, res) => {
  db.prepare("UPDATE comments SET status = 'ignored' WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

apiRouter.post("/comments/:id/regenerate", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const c = db
    .prepare("SELECT * FROM comments WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, vid) as any;
  if (!c) return res.status(404).json({ error: "Comment not found" });
  try {
    const result = await draftCommentReply(cfg, c.from_name, c.message);
    db.prepare("UPDATE comments SET ai_draft = ? WHERE id = ?").run(result.text, c.id);
    res.json({ draft: result.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------- Posts ----------------------------
apiRouter.get("/posts", (req: AuthedRequest, res) => {
  res.json(
    db
      .prepare("SELECT * FROM posts WHERE vendor_id = ? ORDER BY id DESC LIMIT 100")
      .all(vendorId(req))
  );
});

apiRouter.post("/posts/generate", async (req: AuthedRequest, res) => {
  const topic = (req.body?.topic ?? "").toString().trim();
  if (!topic) return res.status(400).json({ error: "Topic is required" });
  try {
    const result = await draftPost(getVendorConfig(vendorId(req)), topic);
    res.json({ text: result.text });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/posts", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const { message, image_url, link, scheduled_at } = req.body ?? {};
  if (!message?.toString().trim()) return res.status(400).json({ error: "Post text is required" });
  const status = scheduled_at ? "scheduled" : "draft";
  const info = db
    .prepare(
      "INSERT INTO posts (vendor_id, message, image_url, link, status, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)"
    )
    .run(vid, message.toString(), image_url?.toString() || null, link?.toString() || null, status, scheduled_at?.toString() || null);
  res.json(db.prepare("SELECT * FROM posts WHERE id = ?").get(info.lastInsertRowid));
});

apiRouter.post("/posts/:id/publish", async (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const cfg = getVendorConfig(vid);
  const post = db
    .prepare("SELECT * FROM posts WHERE id = ? AND vendor_id = ?")
    .get(req.params.id, vid) as PostItem | undefined;
  if (!post) return res.status(404).json({ error: "Post not found" });
  try {
    const result: any = post.image_url
      ? await publishPhoto(cfg, post.image_url, post.message)
      : await publishPost(cfg, post.message, post.link);
    const fbId = result.post_id ?? result.id ?? null;
    db.prepare(
      "UPDATE posts SET status = 'published', fb_post_id = ?, error = NULL WHERE id = ?"
    ).run(fbId, post.id);
    res.json({ ok: true, fb_post_id: fbId });
  } catch (err: any) {
    db.prepare("UPDATE posts SET status = 'failed', error = ? WHERE id = ?").run(err.message, post.id);
    res.status(500).json({ error: err.message });
  }
});

apiRouter.delete("/posts/:id", (req: AuthedRequest, res) => {
  db.prepare("DELETE FROM posts WHERE id = ? AND vendor_id = ?").run(req.params.id, vendorId(req));
  res.json({ ok: true });
});

apiRouter.patch("/posts/:id", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const { message, scheduled_at, title, tags, category } = req.body ?? {};
  const post = db.prepare("SELECT * FROM posts WHERE id = ? AND vendor_id = ?").get(req.params.id, vid);
  if (!post) return res.status(404).json({ error: "Post not found" });
  db.prepare(
    "UPDATE posts SET message=COALESCE(?,message), scheduled_at=COALESCE(?,scheduled_at), title=COALESCE(?,title), tags=COALESCE(?,tags), category=COALESCE(?,category) WHERE id=?"
  ).run(message ?? null, scheduled_at ?? null, title ?? null, tags ?? null, category ?? null, req.params.id);
  res.json(db.prepare("SELECT * FROM posts WHERE id = ?").get(req.params.id));
});

apiRouter.post("/posts/bulk-schedule", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const items = req.body?.posts;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: "posts array required" });
  const stmt = db.prepare(
    "INSERT INTO posts (vendor_id, message, image_url, link, status, scheduled_at, title, tags) VALUES (?, ?, ?, ?, 'scheduled', ?, ?, ?)"
  );
  const ids: number[] = [];
  for (const p of items) {
    if (!p.message?.trim()) continue;
    const info = stmt.run(vid, p.message, p.image_url ?? null, p.link ?? null, p.scheduled_at, p.title ?? null, p.tags ?? null);
    ids.push(Number(info.lastInsertRowid));
  }
  res.json({ ok: true, count: ids.length, ids });
});

apiRouter.get("/post-templates", (req: AuthedRequest, res) => {
  res.json(listTemplates(vendorId(req)));
});

apiRouter.post("/post-templates", (req: AuthedRequest, res) => {
  const { name, message, image_url, link, tags } = req.body ?? {};
  if (!name?.trim() || !message?.trim()) return res.status(400).json({ error: "name and message required" });
  res.json(createTemplate(vendorId(req), { name, message, image_url, link, tags }));
});

apiRouter.delete("/post-templates/:id", (req: AuthedRequest, res) => {
  if (!deleteTemplate(vendorId(req), Number(req.params.id))) return res.status(404).json({ error: "Not found" });
  res.json({ ok: true });
});

// ----------------------------- Orders -----------------------------
apiRouter.get("/orders", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const status = req.query.status?.toString();
  const orders = listOrders(vid, status || undefined).map(orderToPublic);
  res.json(orders);
});

apiRouter.get("/orders/export", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const status = req.query.status?.toString();
  const orders = listOrders(vid, status || undefined);
  const csv = ordersToCsv(orders);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="orders-${vid}.csv"`);
  res.send("\uFEFF" + csv);
});

apiRouter.get("/orders/:id", (req: AuthedRequest, res) => {
  const order = getOrder(vendorId(req), Number(req.params.id));
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(orderToPublic(order));
});

apiRouter.post("/orders", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const { customer_name, customer_phone, customer_address, items, notes, total, conversation_id } =
    req.body ?? {};
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "items array required" });
  }
  try {
    const order = createOrder(vid, {
      conversation_id: conversation_id ?? null,
      customer_name,
      customer_phone,
      customer_address,
      items,
      notes,
      total,
      source: "manual",
    });
    res.json(orderToPublic(order));
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.patch("/orders/:id", (req: AuthedRequest, res) => {
  const vid = vendorId(req);
  const { status, notes } = req.body ?? {};
  const allowed: OrderStatus[] = ["pending", "confirmed", "shipped", "delivered", "cancelled"];
  if (!allowed.includes(status)) return res.status(400).json({ error: "Invalid status" });
  const order = updateOrderStatus(vid, Number(req.params.id), status, notes);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json(orderToPublic(order));
});
