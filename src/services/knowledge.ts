import fs from "node:fs";
import { config } from "../config.js";
import { logger } from "../logger.js";

let cache: { text: string; mtime: number } | null = null;

/** Loads the editable knowledge base file, cached and auto-refreshed on edit. */
export function loadKnowledge(): string {
  try {
    const stat = fs.statSync(config.paths.knowledge);
    if (cache && cache.mtime === stat.mtimeMs) return cache.text;
    const text = fs.readFileSync(config.paths.knowledge, "utf8");
    cache = { text, mtime: stat.mtimeMs };
    return text;
  } catch (err) {
    logger.warn("Knowledge base file not found; using empty knowledge.", err);
    return "(No knowledge base provided yet.)";
  }
}
