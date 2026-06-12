/** Parse AI reply markers: [[PRODUCT:5]], [[HANDOFF]], [[ORDER:{...}]], [[DEAL:{...}]], [[CART:{...}]], [[REMEMBER:...]] */

import type { OrderPayload } from "./orders.js";
import type { DealPayload } from "./deals.js";
import type { CartPayload } from "./cart-intents.js";

const PRODUCT_RE = /\[\[PRODUCT:(\d+)\]\]/gi;
const HANDOFF_RE = /\[\[HANDOFF\]\]/gi;
const REMEMBER_RE = /\[\[REMEMBER:([^\]]+)\]\]/gi;

export interface ParsedReply {
  text: string;
  productIds: number[];
  requestHandoff: boolean;
  order: OrderPayload | null;
  deal: DealPayload | null;
  cart: CartPayload | null;
  memories: string[];
}

function extractJsonMarker<T>(raw: string, prefix: string): { value: T | null; fullMatch: string | null } {
  const start = raw.indexOf(prefix);
  if (start === -1) return { value: null, fullMatch: null };
  const jsonStart = start + prefix.length;
  if (raw[jsonStart] !== "{") return { value: null, fullMatch: null };
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
  if (jsonEnd === -1 || raw.slice(jsonEnd, jsonEnd + 2) !== "]]") return { value: null, fullMatch: null };
  const fullMatch = raw.slice(start, jsonEnd + 2);
  try {
    return { value: JSON.parse(raw.slice(jsonStart, jsonEnd)) as T, fullMatch };
  } catch {
    return { value: null, fullMatch: null };
  }
}

const ORDER_PREFIX = "[[ORDER:";
const DEAL_PREFIX = "[[DEAL:";
const CART_PREFIX = "[[CART:";

export function parseAiReply(raw: string): ParsedReply {
  const productIds = new Set<number>();
  const memories: string[] = [];
  let m: RegExpExecArray | null;
  const productRe = new RegExp(PRODUCT_RE.source, "gi");
  while ((m = productRe.exec(raw)) !== null) {
    productIds.add(Number(m[1]));
  }
  const rememberRe = new RegExp(REMEMBER_RE.source, "gi");
  while ((m = rememberRe.exec(raw)) !== null) {
    const note = m[1]?.trim();
    if (note) memories.push(note);
  }
  const requestHandoff = HANDOFF_RE.test(raw);

  const orderExtract = extractJsonMarker<OrderPayload>(raw, ORDER_PREFIX);
  const dealExtract = extractJsonMarker<DealPayload>(raw, DEAL_PREFIX);
  const cartExtract = extractJsonMarker<CartPayload>(raw, CART_PREFIX);

  let order = orderExtract.value;
  if (order && !order.items?.length) order = null;

  let deal = dealExtract.value;
  if (deal && !deal.stage && !deal.title && !deal.value_estimate && !deal.product_ids?.length && !deal.items?.length) {
    deal = null;
  }

  let cart = cartExtract.value;
  if (cart && !cart.items?.length) cart = null;

  const stripPatterns = [
    PRODUCT_RE,
    HANDOFF_RE,
    REMEMBER_RE,
    orderExtract.fullMatch ? new RegExp(escapeRe(orderExtract.fullMatch), "g") : null,
    dealExtract.fullMatch ? new RegExp(escapeRe(dealExtract.fullMatch), "g") : null,
    cartExtract.fullMatch ? new RegExp(escapeRe(cartExtract.fullMatch), "g") : null,
  ].filter(Boolean) as RegExp[];

  let text = raw;
  for (const re of stripPatterns) text = text.replace(re, "");
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return { text, productIds: [...productIds], requestHandoff, order, deal, cart, memories };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
