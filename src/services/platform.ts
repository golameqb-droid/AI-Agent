import { db, getSetting, setSetting } from "../db.js";

/** Platform-wide AI settings — managed by super admin, shared by all vendors. */
export const PLATFORM_AI_KEYS = [
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_MODEL",
] as const;

export const SECRET_PLATFORM_KEYS = new Set([
  "GEMINI_API_KEY",
  "GROQ_API_KEY",
  "ANTHROPIC_API_KEY",
]);

export interface PlatformAiConfig {
  aiProvider: string;
  geminiApiKey: string;
  geminiModel: string;
  groqApiKey: string;
  groqModel: string;
  anthropicApiKey: string;
  anthropicModel: string;
}

export function getPlatformAiConfig(): PlatformAiConfig {
  const get = (key: string, fallback = "") => getSetting(key) ?? process.env[key] ?? fallback;
  return {
    aiProvider: (get("AI_PROVIDER") || "gemini").toLowerCase(),
    geminiApiKey: get("GEMINI_API_KEY"),
    geminiModel: get("GEMINI_MODEL") || "gemini-2.0-flash",
    groqApiKey: get("GROQ_API_KEY"),
    groqModel: get("GROQ_MODEL") || "llama-3.3-70b-versatile",
    anthropicApiKey: get("ANTHROPIC_API_KEY"),
    anthropicModel: get("ANTHROPIC_MODEL") || "claude-3-5-haiku-20241022",
  };
}

export function setPlatformAiSettings(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (PLATFORM_AI_KEYS.includes(key as any)) setSetting(key, value);
  }
}

export function platformAiConfigured(): boolean {
  const cfg = getPlatformAiConfig();
  if (cfg.aiProvider === "gemini") return Boolean(cfg.geminiApiKey);
  if (cfg.aiProvider === "groq") return Boolean(cfg.groqApiKey);
  if (cfg.aiProvider === "anthropic") return Boolean(cfg.anthropicApiKey);
  return false;
}

/** Import AI keys from .env or legacy vendor_settings into platform settings. */
export function migrateAiToPlatform(): void {
  for (const key of PLATFORM_AI_KEYS) {
    if (getSetting(key)) continue;
    const envVal = process.env[key];
    if (envVal) { setSetting(key, envVal); continue; }
    const legacy = db
      .prepare("SELECT value FROM vendor_settings WHERE key = ? AND value != '' LIMIT 1")
      .get(key) as { value: string } | undefined;
    if (legacy?.value) setSetting(key, legacy.value);
  }
}
