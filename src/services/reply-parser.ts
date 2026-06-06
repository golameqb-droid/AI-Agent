/** Parse AI reply markers: [[PRODUCT:5]], [[HANDOFF]], [[ORDER:{...}]] */

import type { OrderPayload } from "./orders.js";

const PRODUCT_RE = /\[\[PRODUCT:(\d+)\]\]/gi;
const HANDOFF_RE = /\[\[HANDOFF\]\]/gi;
const ORDER_PREFIX = "[[ORDER:";

export interface ParsedReply {
  text: string;
  productIds: number[];
  requestHandoff: boolean;
  order: OrderPayload | null;
}

function extractOrderJson(raw: string): OrderPayload | null {
  const start = raw.indexOf(ORDER_PREFIX);
  if (start === -1) return null;
  const jsonStart = start + ORDER_PREFIX.length;
  if (raw[jsonStart] !== "{") return null;
  let depth = 0;
  let jsonEnd = -1;
  for (let i = jsonStart; i < raw.length; i++) {
    if (raw[i] === "{") depth++;
    else if (raw[i] === "}") {
      depth--;
      if (depth === 0) {
        jsonEnd = i + 1;
        break;
      }
    }
  }
  if (jsonEnd === -1 || raw.slice(jsonEnd, jsonEnd + 2) !== "]]") return null;
  try {
    const parsed = JSON.parse(raw.slice(jsonStart, jsonEnd)) as OrderPayload;
    if (!parsed.items?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

const ORDER_RE = /\[\[ORDER:\{[\s\S]*?\}\]\]/g;

export function parseAiReply(raw: string): ParsedReply {
  const productIds = new Set<number>();
  let m: RegExpExecArray | null;
  const productRe = new RegExp(PRODUCT_RE.source, "gi");
  while ((m = productRe.exec(raw)) !== null) {
    productIds.add(Number(m[1]));
  }
  const requestHandoff = HANDOFF_RE.test(raw);
  const order = extractOrderJson(raw);
  const text = raw
    .replace(PRODUCT_RE, "")
    .replace(HANDOFF_RE, "")
    .replace(ORDER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, productIds: [...productIds], requestHandoff, order };
}
