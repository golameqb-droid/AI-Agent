import { generateForVendor } from "./ai.js";
import { loadVendorKnowledge } from "./knowledge.js";
import { formatProductsForAi } from "./products.js";
import type { AiResult } from "../types.js";
import type { VendorConfig } from "./vendor.js";
import { getVendorById } from "./vendor.js";

function languageInstruction(lang: string): string {
  switch (lang) {
    case "bangla":
      return "Reply in Bangla (Bengali script).";
    case "english":
      return "Reply in clear, simple English.";
    case "auto":
      return "Detect the customer's language and reply in the SAME language and script they used.";
    case "banglish":
    default:
      return "Reply in Banglish — natural Bangla in Roman letters mixed with English, the way Bangladeshis chat on Facebook.";
  }
}

function personaPrompt(cfg: VendorConfig): string {
  const vendor = getVendorById(cfg.vendorId);
  const businessName = vendor?.name ?? "this business";
  const knowledge = loadVendorKnowledge(cfg.vendorId);
  return `You are the official AI customer-care agent for "${businessName}" on Facebook.
You behave like the support team of a large, professional company: warm, fast, accurate, and trustworthy.

LANGUAGE STYLE:
${languageInstruction(cfg.replyLanguage)}

CORE RULES:
- Be polite, friendly and human. Sound like a helpful boro bhai/apu, not a robot.
- Keep replies short and clear (usually 1-4 sentences).
- Only use information from the KNOWLEDGE BASE below. Never invent prices, links, or policies.
- When a relevant link exists in the knowledge base, share it naturally.
- If you do not know something, or it needs a human, say a team member will reply soon.
- Never share passwords. Never argue. Stay on-topic.

PRODUCT & IMAGE RULES:
- When customer asks to see a product photo/image, append [[PRODUCT:ID]] at the END of your reply (use the ID from catalog).
- You may append multiple [[PRODUCT:ID]] tags if showing several items.
- When customer wants to talk to a human/agent/manager, append [[HANDOFF]] at the END and politely say a team member will reply soon.
- When customer wants to ORDER/BUY and you have product + quantity + phone + delivery address, append at the END:
  [[ORDER:{"customer_name":"","phone":"","address":"","items":[{"product_id":1,"name":"Product name","qty":1,"price":"৳500"}],"notes":"","total":""}]]
  Use product_id from catalog when known. Ask for missing details before placing the order.
- Do NOT write [[PRODUCT:ID]], [[HANDOFF]], or [[ORDER:...]] in the middle of sentences — only at the very end.

=========================  PRODUCT CATALOG  =========================
${formatProductsForAi(cfg.vendorId)}

=========================  KNOWLEDGE BASE  =========================
${knowledge}
===================================================================`;
}

export async function draftMessageReply(
  cfg: VendorConfig,
  customerName: string | null,
  customerText: string,
  history?: { direction: string; text: string }[]
): Promise<AiResult> {
  const name = customerName ? `Customer name: ${customerName}\n` : "";
  const convo =
    history?.length
      ? `Recent conversation:\n${history
          .map((m) => `${m.direction === "in" ? "Customer" : "Us"}: ${m.text}`)
          .join("\n")}\n\n`
      : "";
  const user = `${name}${convo}Customer message:\n"""${customerText}"""\n\nWrite the best reply.`;
  return generateForVendor(cfg, { system: personaPrompt(cfg), user, purpose: "message_reply" });
}

export async function draftCommentReply(
  cfg: VendorConfig,
  fromName: string | null,
  commentText: string
): Promise<AiResult> {
  const name = fromName ? `Commenter: ${fromName}\n` : "";
  const user = `${name}Comment on our post:\n"""${commentText}"""\n\nWrite a short public reply (1-2 sentences).`;
  return generateForVendor(cfg, { system: personaPrompt(cfg), user, purpose: "comment_reply" });
}

export async function draftPost(cfg: VendorConfig, topic: string): Promise<AiResult> {
  const vendor = getVendorById(cfg.vendorId);
  const system = `You are the social media manager for "${vendor?.name ?? "this business"}".
Write engaging Facebook posts for a Bangladeshi audience.
${languageInstruction(cfg.replyLanguage)}
Use a hook, value, CTA, and 3-6 hashtags.

Business info:
${loadVendorKnowledge(cfg.vendorId)}`;
  const user = `Write a complete Facebook post about: "${topic}". Return only the post text.`;
  return generateForVendor(cfg, { system, user, temperature: 0.85, maxTokens: 600, purpose: "post_draft" });
}
