import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

const ENV_PATH = path.join(config.paths.root, ".env");
const ENV_EXAMPLE_PATH = path.join(config.paths.root, ".env.example");

/** Keys the dashboard is allowed to read/write. */
export const EDITABLE_KEYS = [
  "PORT",
  "DASHBOARD_USER",
  "DASHBOARD_PASS",
  "AI_PROVIDER",
  "GEMINI_API_KEY",
  "GEMINI_MODEL",
  "GROQ_API_KEY",
  "GROQ_MODEL",
  "FB_PAGE_ID",
  "FB_PAGE_ACCESS_TOKEN",
  "FB_VERIFY_TOKEN",
  "FB_GRAPH_VERSION",
  "AUTO_REPLY_MESSAGES",
  "AUTO_REPLY_COMMENTS",
  "REPLY_LANGUAGE",
] as const;

export type EnvKey = (typeof EDITABLE_KEYS)[number];

/** Parse a .env file's contents into a key→value map. */
function parse(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/** Read current env values (from .env, falling back to process.env / example). */
export function readEnv(): Record<string, string> {
  let fileValues: Record<string, string> = {};
  try {
    if (fs.existsSync(ENV_PATH)) {
      fileValues = parse(fs.readFileSync(ENV_PATH, "utf8"));
    } else if (fs.existsSync(ENV_EXAMPLE_PATH)) {
      fileValues = parse(fs.readFileSync(ENV_EXAMPLE_PATH, "utf8"));
    }
  } catch {
    /* ignore */
  }
  const result: Record<string, string> = {};
  for (const key of EDITABLE_KEYS) {
    result[key] = fileValues[key] ?? process.env[key] ?? "";
  }
  return result;
}

function quoteIfNeeded(value: string): string {
  return /[\s#"']/.test(value) ? JSON.stringify(value) : value;
}

/**
 * Merge updates into the existing .env file, preserving comments and ordering.
 * Keys that already exist are updated in place; new keys are appended.
 */
export function writeEnv(updates: Record<string, string>): void {
  let lines: string[] = [];
  if (fs.existsSync(ENV_PATH)) {
    lines = fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
  } else if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    lines = fs.readFileSync(ENV_EXAMPLE_PATH, "utf8").split(/\r?\n/);
  }

  const remaining = new Set(Object.keys(updates));

  const newLines = lines.map((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return line;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return line;
    const key = trimmed.slice(0, eq).trim();
    if (key in updates) {
      remaining.delete(key);
      return `${key}=${quoteIfNeeded(updates[key])}`;
    }
    return line;
  });

  for (const key of remaining) {
    newLines.push(`${key}=${quoteIfNeeded(updates[key])}`);
  }

  fs.writeFileSync(ENV_PATH, newLines.join("\n"), "utf8");
}
