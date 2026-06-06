import { Router } from "express";
import { config } from "../config.js";
import { db } from "../db.js";
import { requireAuth, requireSuperAdmin } from "../middleware/auth.js";
import { productImageUpload } from "../middleware/upload.js";
import {
  listProducts,
  createProduct,
  updateProduct,
  deleteProduct,
} from "../services/products.js";
import { listOrders, ordersToCsv, orderToPublic } from "../services/orders.js";
import { activateSubscription, getSubscription } from "../services/subscription.js";
import { listPayments, completePayment } from "../services/payments.js";
import type { PlanId } from "../services/plans.js";
import {
  getVendorConfig,
  setVendorSettings,
  VENDOR_ADMIN_KEYS,
  SECRET_VENDOR_KEYS,
  getVendorById,
  getVendorSetting,
} from "../services/vendor.js";
import {
  getPlatformAiConfig,
  setPlatformAiSettings,
  platformAiConfigured,
  PLATFORM_AI_KEYS,
  SECRET_PLATFORM_KEYS,
} from "../services/platform.js";
import {
  getPlatformPaymentConfig,
  setPlatformPaymentSettings,
  paymentsConfigured,
  PLATFORM_PAYMENT_KEYS,
  SECRET_PAYMENT_KEYS,
} from "../services/platform-payments.js";
import { loadVendorKnowledge, saveVendorKnowledge } from "../services/knowledge.js";
import { registerVendor, hashPassword } from "../services/auth.js";
import { channelConfigured } from "../services/channels.js";
import { getPlatformKpis } from "../services/kpis.js";
import { platformKpisToCsv, platformKpiReportHtml } from "../services/kpi-export.js";
import {
  getPlatformMetaConfig,
  setPlatformMetaSettings,
  metaAppConfigured,
  PLATFORM_META_KEYS,
  SECRET_META_KEYS,
} from "../services/platform-meta.js";

export const adminRouter = Router();
adminRouter.use(requireAuth, requireSuperAdmin);

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

// ---- Platform KPIs (rich metrics) ----
adminRouter.get("/kpis", (_req, res) => {
  res.json(getPlatformKpis());
});

adminRouter.get("/kpis/export.csv", (_req, res) => {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="kpi-platform.csv"`);
  res.send(platformKpisToCsv());
});

adminRouter.get("/kpis/report", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(platformKpiReportHtml());
});

// ---- Platform stats (legacy + KPI summary) ----
adminRouter.get("/stats", (_req, res) => {
  const one = (sql: string, ...params: unknown[]) =>
    (db.prepare(sql).get(...params) as { c: number }).c;
  const month = new Date().toISOString().slice(0, 7);
  const vendors = db.prepare("SELECT id, name, plan, status FROM vendors ORDER BY id").all() as {
    id: number;
    name: string;
    plan: string;
    status: string;
  }[];
  const topVendors = vendors
    .map((v) => {
      const cfg = getVendorConfig(v.id);
      const usage = db
        .prepare("SELECT ai_replies, messages_in, messages_out FROM usage_monthly WHERE vendor_id = ? AND month = ?")
        .get(v.id, month) as { ai_replies: number; messages_in: number; messages_out: number } | undefined;
      return {
        id: v.id,
        name: v.name,
        plan: v.plan,
        status: v.status,
        aiReplies: usage?.ai_replies ?? 0,
        messagesIn: usage?.messages_in ?? 0,
        messagesOut: usage?.messages_out ?? 0,
        channels: {
          messenger: channelConfigured(cfg, "messenger"),
          whatsapp: channelConfigured(cfg, "whatsapp"),
          instagram: channelConfigured(cfg, "instagram"),
        },
      };
    })
    .sort((a, b) => b.aiReplies - a.aiReplies)
    .slice(0, 8);
  res.json({
    vendors: one("SELECT COUNT(*) c FROM vendors"),
    activeVendors: one("SELECT COUNT(*) c FROM vendors WHERE status = 'active'"),
    trialVendors: one("SELECT COUNT(*) c FROM vendors WHERE status = 'trial'"),
    suspendedVendors: one("SELECT COUNT(*) c FROM vendors WHERE status = 'suspended'"),
    conversations: one("SELECT COUNT(*) c FROM conversations"),
    messages: one("SELECT COUNT(*) c FROM messages"),
    posts: one("SELECT COUNT(*) c FROM posts"),
    orders: one("SELECT COUNT(*) c FROM orders"),
    aiRepliesThisMonth: one(
      "SELECT COALESCE(SUM(ai_replies), 0) c FROM usage_monthly WHERE month = ?",
      month
    ),
    messagesInThisMonth: one(
      "SELECT COALESCE(SUM(messages_in), 0) c FROM usage_monthly WHERE month = ?",
      month
    ),
    messagesOutThisMonth: one(
      "SELECT COALESCE(SUM(messages_out), 0) c FROM usage_monthly WHERE month = ?",
      month
    ),
    pendingPayments: one("SELECT COUNT(*) c FROM payments WHERE status = 'pending'"),
    month,
    topVendors,
    aiConfigured: platformAiConfigured(),
    payments: paymentsConfigured(),
  });
});

// ---- Platform AI config (ONE for all vendors) ----
adminRouter.get("/platform/ai", (_req, res) => {
  const cfg = getPlatformAiConfig();
  const masked: Record<string, string> = {};
  const isSet: Record<string, boolean> = {};
  const map: Record<string, string> = {
    AI_PROVIDER: cfg.aiProvider,
    GEMINI_API_KEY: cfg.geminiApiKey,
    GEMINI_MODEL: cfg.geminiModel,
    GROQ_API_KEY: cfg.groqApiKey,
    GROQ_MODEL: cfg.groqModel,
    ANTHROPIC_API_KEY: cfg.anthropicApiKey,
    ANTHROPIC_MODEL: cfg.anthropicModel,
  };
  for (const key of PLATFORM_AI_KEYS) {
    const v = map[key] ?? "";
    isSet[key] = Boolean(v);
    masked[key] = SECRET_PLATFORM_KEYS.has(key) ? maskValue(v) : v;
  }
  res.json({ values: masked, isSet, secretKeys: [...SECRET_PLATFORM_KEYS] });
});

adminRouter.put("/platform/ai", (req, res) => {
  const incoming = (req.body?.values ?? {}) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const key of PLATFORM_AI_KEYS) {
    if (!(key in incoming)) continue;
    const val = (incoming[key] ?? "").toString();
    if (SECRET_PLATFORM_KEYS.has(key) && (val === "" || val.startsWith("••••"))) continue;
    updates[key] = val;
  }
  setPlatformAiSettings(updates);
  res.json({ ok: true });
});

// ---- Platform payment config (bKash, Nagad, SSLCommerz) ----
adminRouter.get("/platform/payments", (_req, res) => {
  const cfg = getPlatformPaymentConfig();
  const map: Record<string, string> = {
    BKASH_APP_KEY: cfg.bkashAppKey,
    BKASH_APP_SECRET: cfg.bkashAppSecret,
    BKASH_USERNAME: cfg.bkashUsername,
    BKASH_PASSWORD: cfg.bkashPassword,
    BKASH_SANDBOX: String(cfg.bkashSandbox),
    BKASH_MERCHANT_NUMBER: cfg.bkashMerchantNumber,
    NAGAD_MERCHANT_ID: cfg.nagadMerchantId,
    NAGAD_MERCHANT_NUMBER: cfg.nagadMerchantNumber,
    NAGAD_PUBLIC_KEY: cfg.nagadPublicKey,
    NAGAD_PRIVATE_KEY: cfg.nagadPrivateKey,
    NAGAD_SANDBOX: String(cfg.nagadSandbox),
    SSLCOMMERZ_STORE_ID: cfg.sslcommerzStoreId,
    SSLCOMMERZ_STORE_PASS: cfg.sslcommerzStorePass,
    SSLCOMMERZ_SANDBOX: String(cfg.sslcommerzSandbox),
    SALES_EMAIL: cfg.salesEmail,
    SALES_WHATSAPP: cfg.salesWhatsapp,
  };
  const masked: Record<string, string> = {};
  for (const key of PLATFORM_PAYMENT_KEYS) {
    const v = map[key] ?? "";
    masked[key] = SECRET_PAYMENT_KEYS.has(key) ? maskValue(v) : v;
  }
  res.json({ values: masked, configured: paymentsConfigured(), secretKeys: [...SECRET_PAYMENT_KEYS] });
});

adminRouter.put("/platform/payments", (req, res) => {
  const incoming = (req.body?.values ?? {}) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const key of PLATFORM_PAYMENT_KEYS) {
    if (!(key in incoming)) continue;
    const val = (incoming[key] ?? "").toString();
    if (SECRET_PAYMENT_KEYS.has(key) && (val === "" || val.startsWith("••••"))) continue;
    updates[key] = val;
  }
  setPlatformPaymentSettings(updates);
  res.json({ ok: true, configured: paymentsConfigured() });
});

// ---- Meta OAuth app (Facebook / Instagram connect wizard) ----
adminRouter.get("/platform/meta", (_req, res) => {
  const cfg = getPlatformMetaConfig();
  const masked: Record<string, string> = {};
  for (const key of PLATFORM_META_KEYS) {
    const v = key === "META_APP_ID" ? cfg.appId : cfg.appSecret;
    masked[key] = SECRET_META_KEYS.has(key) ? maskValue(v) : v;
  }
  res.json({
    values: masked,
    configured: metaAppConfigured(),
    redirectUri: `${config.platform.publicBaseUrl.replace(/\/$/, "")}/api/meta/oauth/callback`,
    secretKeys: [...SECRET_META_KEYS],
  });
});

adminRouter.put("/platform/meta", (req, res) => {
  const incoming = (req.body?.values ?? {}) as Record<string, string>;
  const updates: Record<string, string> = {};
  for (const key of PLATFORM_META_KEYS) {
    if (!(key in incoming)) continue;
    const val = (incoming[key] ?? "").toString();
    if (SECRET_META_KEYS.has(key) && (val === "" || val.startsWith("••••"))) continue;
    updates[key] = val;
  }
  setPlatformMetaSettings(updates);
  res.json({ ok: true, configured: metaAppConfigured() });
});

// ---- Vendor list ----
adminRouter.get("/vendors", (_req, res) => {
  const month = new Date().toISOString().slice(0, 7);
  const vendors = db
    .prepare(
      `SELECT v.*,
        (SELECT value FROM vendor_settings WHERE vendor_id=v.id AND key='FB_PAGE_ID') AS fb_page_id,
        (SELECT COUNT(*) FROM conversations c WHERE c.vendor_id = v.id) AS conversations,
        (SELECT COUNT(*) FROM posts p WHERE p.vendor_id = v.id) AS posts,
        (SELECT COALESCE(ai_replies, 0) FROM usage_monthly u WHERE u.vendor_id = v.id AND u.month = ?) AS ai_replies_month
       FROM vendors v ORDER BY v.created_at DESC`
    )
    .all(month) as Record<string, unknown>[];
  for (const vd of vendors) {
    const cfg = getVendorConfig(Number(vd.id));
    vd.channels = {
      messenger: channelConfigured(cfg, "messenger"),
      whatsapp: channelConfigured(cfg, "whatsapp"),
      instagram: channelConfigured(cfg, "instagram"),
    };
  }
  res.json(vendors);
});

// ---- Create vendor (admin creates on behalf of vendor) ----
adminRouter.post("/vendors", (req, res) => {
  const { businessName, ownerName, email, password, phone } = req.body ?? {};
  if (!businessName?.trim() || !ownerName?.trim() || !email?.trim() || !password) {
    return res.status(400).json({ error: "businessName, ownerName, email, password required" });
  }
  try {
    const { vendorId, user } = registerVendor({
      businessName: String(businessName),
      ownerName: String(ownerName),
      email: String(email),
      password: String(password),
      phone: phone ? String(phone) : undefined,
    });
    const vendor = getVendorById(vendorId)!;
    res.json({ vendor, user: { id: user.id, email: user.email, name: user.name } });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

adminRouter.patch("/vendors/:id/plan", (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
  const { plan } = req.body ?? {};
  if (!["trial", "pro", "elite", "enterprise"].includes(plan)) {
    return res.status(400).json({ error: "Invalid plan" });
  }
  activateSubscription(vid, plan as PlanId);
  res.json({ ok: true, subscription: getSubscription(vid) });
});

adminRouter.get("/payments", (_req, res) => {
  res.json(listPayments());
});

adminRouter.post("/payments/:id/confirm", (req, res) => {
  if (!completePayment(Number(req.params.id))) return res.status(404).json({ error: "Payment not found" });
  res.json({ ok: true });
});

adminRouter.patch("/vendors/:id/status", (req, res) => {
  const { status } = req.body ?? {};
  if (!["trial", "active", "suspended", "cancelled"].includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  db.prepare("UPDATE vendors SET status = ?, updated_at = datetime('now') WHERE id = ?").run(
    status,
    req.params.id
  );
  res.json({ ok: true });
});

// ---- Per-vendor technical config (FB + behaviour) ----
adminRouter.get("/vendors/:id/config", (req, res) => {
  const vendor = getVendorById(Number(req.params.id));
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  const cfg = getVendorConfig(Number(req.params.id));
  const masked: Record<string, string> = {};
  const map: Record<string, string> = {
    FB_PAGE_ID: cfg.fbPageId,
    FB_PAGE_ACCESS_TOKEN: cfg.fbPageAccessToken,
    FB_GRAPH_VERSION: cfg.fbGraphVersion,
    WA_PHONE_NUMBER_ID: getVendorSetting(Number(req.params.id), "WA_PHONE_NUMBER_ID") ?? "",
    WA_ACCESS_TOKEN: getVendorSetting(Number(req.params.id), "WA_ACCESS_TOKEN") ?? "",
    IG_ACCOUNT_ID: getVendorSetting(Number(req.params.id), "IG_ACCOUNT_ID") ?? "",
    AUTO_REPLY_MESSAGES: String(cfg.autoReplyMessages),
    AUTO_REPLY_COMMENTS: String(cfg.autoReplyComments),
    REPLY_LANGUAGE: cfg.replyLanguage,
  };
  for (const key of VENDOR_ADMIN_KEYS) {
    const v = map[key] ?? "";
    masked[key] = SECRET_VENDOR_KEYS.has(key) ? maskValue(v) : v;
  }
  res.json({ vendor, values: masked, secretKeys: [...SECRET_VENDOR_KEYS] });
});

adminRouter.put("/vendors/:id/config", (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
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

// ---- Per-vendor knowledge base ----
adminRouter.get("/vendors/:id/knowledge", (req, res) => {
  const vendor = getVendorById(Number(req.params.id));
  if (!vendor) return res.status(404).json({ error: "Vendor not found" });
  res.json({ vendor, content: loadVendorKnowledge(Number(req.params.id)) });
});

adminRouter.put("/vendors/:id/knowledge", (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
  saveVendorKnowledge(vid, (req.body?.content ?? "").toString());
  res.json({ ok: true });
});

// ---- Per-vendor product catalog ----
adminRouter.get("/vendors/:id/products", (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
  res.json(listProducts(vid));
});

adminRouter.post("/vendors/:id/products", productImageUpload.single("image"), (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
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

adminRouter.put("/vendors/:id/products/:pid", productImageUpload.single("image"), (req, res) => {
  const vid = Number(req.params.id);
  const pid = Number(req.params.pid);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
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

adminRouter.delete("/vendors/:id/products/:pid", (req, res) => {
  const vid = Number(req.params.id);
  const pid = Number(req.params.pid);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
  if (!deleteProduct(vid, pid)) return res.status(404).json({ error: "Product not found" });
  res.json({ ok: true });
});

// ---- Per-vendor orders ----
adminRouter.get("/vendors/:id/orders", (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
  const status = req.query.status?.toString();
  res.json(listOrders(vid, status || undefined).map(orderToPublic));
});

adminRouter.get("/vendors/:id/orders/export", (req, res) => {
  const vid = Number(req.params.id);
  if (!getVendorById(vid)) return res.status(404).json({ error: "Vendor not found" });
  const status = req.query.status?.toString();
  const csv = ordersToCsv(listOrders(vid, status || undefined));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="orders-vendor-${vid}.csv"`);
  res.send("\uFEFF" + csv);
});

// ---- Reset vendor password ----
adminRouter.post("/vendors/:id/reset-password", (req, res) => {
  const { password } = req.body ?? {};
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: "Password min 6 chars" });
  }
  const user = db
    .prepare("SELECT id FROM users WHERE vendor_id = ? AND role = 'vendor_owner'")
    .get(req.params.id) as { id: number } | undefined;
  if (!user) return res.status(404).json({ error: "Vendor owner not found" });
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(
    hashPassword(String(password)),
    user.id
  );
  res.json({ ok: true });
});
