import { getSetting, setSetting } from "../db.js";
import { config } from "../config.js";

export const PLATFORM_META_KEYS = ["META_APP_ID", "META_APP_SECRET"] as const;
export const SECRET_META_KEYS = new Set(["META_APP_SECRET"]);

export interface PlatformMetaConfig {
  appId: string;
  appSecret: string;
}

export function getPlatformMetaConfig(): PlatformMetaConfig {
  return {
    appId: getSetting("META_APP_ID") ?? process.env.META_APP_ID ?? "",
    appSecret: getSetting("META_APP_SECRET") ?? process.env.META_APP_SECRET ?? "",
  };
}

export function setPlatformMetaSettings(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (PLATFORM_META_KEYS.includes(key as (typeof PLATFORM_META_KEYS)[number])) {
      setSetting(key, value);
    }
  }
}

export function metaAppConfigured(): boolean {
  const cfg = getPlatformMetaConfig();
  return Boolean(cfg.appId && cfg.appSecret);
}

export function metaOAuthRedirectUri(): string {
  const base = config.platform.publicBaseUrl.replace(/\/$/, "");
  return `${base}/api/meta/oauth/callback`;
}
