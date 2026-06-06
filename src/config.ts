import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, "..");

// Always load the mounted .env file and override stale Docker env vars.
dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: true });

function bool(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

export const config = {
  port: Number(process.env.PORT ?? 3000),

  platform: {
    name: "SocialAI Pro",
    jwtSecret: process.env.JWT_SECRET ?? "socialai-pro-change-me-in-production",
    superAdminEmail: process.env.SUPER_ADMIN_EMAIL ?? "admin@socialai.pro",
    superAdminPassword: process.env.SUPER_ADMIN_PASSWORD ?? "admin123",
    webhookVerifyToken:
      process.env.FB_VERIFY_TOKEN ?? "socialai_pro_verify_secret_123",
    /** Public URL for product images (must be HTTPS for Facebook). e.g. https://your-tunnel.trycloudflare.com */
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${Number(process.env.PORT ?? 3000)}`,
  },

  // Legacy single-tenant fallback (platform uses vendor_settings per vendor)
  dashboard: {
    user: process.env.DASHBOARD_USER ?? "admin",
    pass: process.env.DASHBOARD_PASS ?? "changeme",
  },

  ai: {
    provider: (process.env.AI_PROVIDER ?? "gemini").toLowerCase(),
    gemini: {
      apiKey: process.env.GEMINI_API_KEY ?? "",
      model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash",
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY ?? "",
      model: process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile",
    },
    anthropic: {
      apiKey: process.env.ANTHROPIC_API_KEY ?? "",
      model: process.env.ANTHROPIC_MODEL ?? "claude-3-5-haiku-20241022",
    },
  },

  facebook: {
    pageId: process.env.FB_PAGE_ID ?? "",
    pageAccessToken: process.env.FB_PAGE_ACCESS_TOKEN ?? "",
    verifyToken: process.env.FB_VERIFY_TOKEN ?? "socialai_pro_verify_secret_123",
    graphVersion: process.env.FB_GRAPH_VERSION ?? "v21.0",
  },

  behaviour: {
    autoReplyMessages: bool(process.env.AUTO_REPLY_MESSAGES, false),
    autoReplyComments: bool(process.env.AUTO_REPLY_COMMENTS, false),
    replyLanguage: (process.env.REPLY_LANGUAGE ?? "banglish").toLowerCase(),
  },

  paths: {
    root: ROOT_DIR,
    data: path.join(ROOT_DIR, "data"),
    db: path.join(ROOT_DIR, "data", "agent.db"),
    knowledge: path.join(ROOT_DIR, "knowledge", "equestionbankbd.md"),
    public: path.join(ROOT_DIR, "public"),
    uploads: path.join(ROOT_DIR, "data", "uploads"),
  },

  payments: {
    bkash: { merchant: process.env.BKASH_MERCHANT ?? "", username: process.env.BKASH_USERNAME ?? "", password: process.env.BKASH_PASSWORD ?? "" },
    nagad: { merchantId: process.env.NAGAD_MERCHANT_ID ?? "", publicKey: process.env.NAGAD_PUBLIC_KEY ?? "" },
    sslcommerz: { storeId: process.env.SSLCOMMERZ_STORE_ID ?? "", storePass: process.env.SSLCOMMERZ_STORE_PASS ?? "", sandbox: bool(process.env.SSLCOMMERZ_SANDBOX, true) },
  },

  sales: {
    email: process.env.SALES_EMAIL ?? "sales@socialai.pro",
    whatsapp: process.env.SALES_WHATSAPP ?? "",
  },
};

/**
 * Apply a set of env updates to both process.env and the live in-memory config,
 * so dashboard edits take effect immediately (PORT change still needs a restart).
 */
export function applyEnvUpdates(updates: Record<string, string>): void {
  for (const [key, value] of Object.entries(updates)) {
    process.env[key] = value;
  }
  if (updates.DASHBOARD_USER !== undefined) config.dashboard.user = updates.DASHBOARD_USER;
  if (updates.DASHBOARD_PASS !== undefined) config.dashboard.pass = updates.DASHBOARD_PASS;

  if (updates.AI_PROVIDER !== undefined) config.ai.provider = updates.AI_PROVIDER.toLowerCase();
  if (updates.GEMINI_API_KEY !== undefined) config.ai.gemini.apiKey = updates.GEMINI_API_KEY;
  if (updates.GEMINI_MODEL !== undefined) config.ai.gemini.model = updates.GEMINI_MODEL;
  if (updates.GROQ_API_KEY !== undefined) config.ai.groq.apiKey = updates.GROQ_API_KEY;
  if (updates.GROQ_MODEL !== undefined) config.ai.groq.model = updates.GROQ_MODEL;

  if (updates.FB_PAGE_ID !== undefined) config.facebook.pageId = updates.FB_PAGE_ID;
  if (updates.FB_PAGE_ACCESS_TOKEN !== undefined)
    config.facebook.pageAccessToken = updates.FB_PAGE_ACCESS_TOKEN;
  if (updates.FB_VERIFY_TOKEN !== undefined) config.facebook.verifyToken = updates.FB_VERIFY_TOKEN;
  if (updates.FB_GRAPH_VERSION !== undefined)
    config.facebook.graphVersion = updates.FB_GRAPH_VERSION;

  if (updates.AUTO_REPLY_MESSAGES !== undefined)
    config.behaviour.autoReplyMessages = bool(updates.AUTO_REPLY_MESSAGES);
  if (updates.AUTO_REPLY_COMMENTS !== undefined)
    config.behaviour.autoReplyComments = bool(updates.AUTO_REPLY_COMMENTS);
  if (updates.REPLY_LANGUAGE !== undefined)
    config.behaviour.replyLanguage = updates.REPLY_LANGUAGE.toLowerCase();
}

export function aiConfigured(): boolean {
  if (config.ai.provider === "gemini") return Boolean(config.ai.gemini.apiKey);
  if (config.ai.provider === "groq") return Boolean(config.ai.groq.apiKey);
  return false;
}

export function facebookConfigured(): boolean {
  return Boolean(config.facebook.pageId && config.facebook.pageAccessToken);
}
