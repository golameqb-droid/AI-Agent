import { db } from "../db.js";
import { getPlatformAiConfig } from "./platform.js";

export interface VendorConfig {
  vendorId: number;
  aiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  groqApiKey: string;
  groqModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
  fbPageId: string;
  fbPageAccessToken: string;
  fbGraphVersion: string;
  autoReplyMessages: boolean;
  autoReplyComments: boolean;
  replyLanguage: string;
}

export interface VendorRow {
  id: number;
  name: string;
  slug: string;
  email: string;
  phone: string | null;
  status: string;
  plan: string;
  created_at: string;
  updated_at: string;
}

function bool(val: string | undefined | null, fallback = false): boolean {
  if (val === undefined || val === null) return fallback;
  return ["1", "true", "yes", "on"].includes(val.toLowerCase());
}

export function getVendorSetting(vendorId: number, key: string): string | null {
  const row = db
    .prepare("SELECT value FROM vendor_settings WHERE vendor_id = ? AND key = ?")
    .get(vendorId, key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setVendorSetting(vendorId: number, key: string, value: string): void {
  db.prepare(
    `INSERT INTO vendor_settings (vendor_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(vendor_id, key) DO UPDATE SET value = excluded.value`
  ).run(vendorId, key, value);
}

export function setVendorSettings(vendorId: number, settings: Record<string, string>): void {
  const stmt = db.prepare(
    `INSERT INTO vendor_settings (vendor_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(vendor_id, key) DO UPDATE SET value = excluded.value`
  );
  for (const [key, value] of Object.entries(settings)) stmt.run(vendorId, key, value);
}

/** Merges platform AI (shared) + per-vendor Facebook/behaviour (admin-managed). */
export function getVendorConfig(vendorId: number): VendorConfig {
  const ai = getPlatformAiConfig();
  return {
    vendorId,
    aiProvider: ai.aiProvider,
    geminiApiKey: ai.geminiApiKey,
    geminiModel: ai.geminiModel,
    groqApiKey: ai.groqApiKey,
    groqModel: ai.groqModel,
    anthropicApiKey: ai.anthropicApiKey,
    anthropicModel: ai.anthropicModel,
    fbPageId: getVendorSetting(vendorId, "FB_PAGE_ID") ?? "",
    fbPageAccessToken: getVendorSetting(vendorId, "FB_PAGE_ACCESS_TOKEN") ?? "",
    fbGraphVersion: getVendorSetting(vendorId, "FB_GRAPH_VERSION") || "v21.0",
    autoReplyMessages: bool(getVendorSetting(vendorId, "AUTO_REPLY_MESSAGES")),
    autoReplyComments: bool(getVendorSetting(vendorId, "AUTO_REPLY_COMMENTS")),
    replyLanguage: (getVendorSetting(vendorId, "REPLY_LANGUAGE") || "banglish").toLowerCase(),
  };
}

export function findVendorByPageId(pageId: string): number | null {
  const row = db
    .prepare("SELECT vendor_id FROM vendor_settings WHERE key = 'FB_PAGE_ID' AND value = ?")
    .get(pageId) as { vendor_id: number } | undefined;
  return row?.vendor_id ?? null;
}

export function getVendorById(id: number): VendorRow | null {
  return (db.prepare("SELECT * FROM vendors WHERE id = ?").get(id) as VendorRow) ?? null;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || "vendor";
}

export function vendorAiConfigured(cfg: VendorConfig): boolean {
  if (cfg.aiProvider === "gemini") return Boolean(cfg.geminiApiKey);
  if (cfg.aiProvider === "groq") return Boolean(cfg.groqApiKey);
  if (cfg.aiProvider === "anthropic") return Boolean(cfg.anthropicApiKey);
  return false;
}

export function vendorFacebookConfigured(cfg: VendorConfig): boolean {
  return Boolean(cfg.fbPageId && cfg.fbPageAccessToken);
}

/** Per-vendor channel + behaviour settings (vendor panel or super admin). */
export const VENDOR_ADMIN_KEYS = [
  "FB_PAGE_ID",
  "FB_PAGE_ACCESS_TOKEN",
  "FB_GRAPH_VERSION",
  "WA_PHONE_NUMBER_ID",
  "WA_ACCESS_TOKEN",
  "IG_ACCOUNT_ID",
  "AUTO_REPLY_MESSAGES",
  "AUTO_REPLY_COMMENTS",
  "REPLY_LANGUAGE",
] as const;

export const SECRET_VENDOR_KEYS = new Set(["FB_PAGE_ACCESS_TOKEN", "WA_ACCESS_TOKEN"]);
