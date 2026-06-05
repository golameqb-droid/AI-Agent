import { config } from "../config.js";
import { generate } from "./ai.js";
import { loadKnowledge } from "./knowledge.js";
import type { AiResult } from "../types.js";

function languageInstruction(): string {
  switch (config.behaviour.replyLanguage) {
    case "bangla":
      return "Reply in Bangla (Bengali script).";
    case "english":
      return "Reply in clear, simple English.";
    case "auto":
      return "Detect the customer's language and reply in the SAME language and script they used.";
    case "banglish":
    default:
      return "Reply in Banglish — natural Bangla written in English/Roman letters mixed with common English words, the way young Bangladeshis chat on Facebook. Example tone: 'Apnar order ta confirm kore dilam, dhonnobad!'";
  }
}

/** The core persona / system prompt used for every customer interaction. */
function personaPrompt(): string {
  const knowledge = loadKnowledge();
  return `You are the official AI customer-care agent for the Facebook Page "eQuestionBankBD".
You behave like the support team of a large, professional company: warm, fast, accurate, and trustworthy.

LANGUAGE STYLE:
${languageInstruction()}

CORE RULES:
- Be polite, friendly and human. Sound like a helpful boro bhai/apu, not a robot.
- Keep replies short and clear (usually 1-4 sentences). Use line breaks if needed.
- Only use information from the KNOWLEDGE BASE below. Never invent prices, links, dates or policies.
- When a relevant link exists in the knowledge base, share it naturally.
- If you do not know something, or it needs a human (refund, complaint, payment dispute, account issue),
  apologize briefly and say a team member will reply soon. Do NOT make things up.
- Never share passwords or sensitive data. Never argue. Stay positive and on-topic.
- If the customer is just greeting or thanking, respond warmly and briefly.

=========================  KNOWLEDGE BASE  =========================
${knowledge}
===================================================================`;
}

/** Generate a reply to a customer's Messenger message. */
export async function draftMessageReply(
  customerName: string | null,
  customerText: string,
  history?: { direction: string; text: string }[]
): Promise<AiResult> {
  const name = customerName ? `Customer name: ${customerName}\n` : "";
  const convo =
    history && history.length
      ? `Recent conversation (oldest first):\n${history
          .map((m) => `${m.direction === "in" ? "Customer" : "Us"}: ${m.text}`)
          .join("\n")}\n\n`
      : "";

  const user = `${name}${convo}The customer just sent this message on Messenger:\n"""${customerText}"""\n\nWrite the best reply now.`;
  return generate({ system: personaPrompt(), user });
}

/** Generate a reply to a comment on a Facebook post. */
export async function draftCommentReply(
  fromName: string | null,
  commentText: string
): Promise<AiResult> {
  const name = fromName ? `Commenter: ${fromName}\n` : "";
  const user = `${name}Someone left this comment on one of our Facebook posts:\n"""${commentText}"""\n\nWrite a short, friendly public reply (1-2 sentences). If their question needs private details, invite them to message the page.`;
  return generate({ system: personaPrompt(), user });
}

/** Generate a full Facebook post (caption/content) from a topic or instruction. */
export async function draftPost(topic: string): Promise<AiResult> {
  const system = `You are the social media manager for the Facebook Page "eQuestionBankBD".
Write engaging, professional Facebook posts that get likes, comments and shares.
${languageInstruction()}
Use a catchy hook, clear value, a call-to-action, and 3-6 relevant hashtags at the end.
Use tasteful emojis. Keep it suitable for a Bangladeshi student/job-seeker audience.

Reference info about the business:
${loadKnowledge()}`;

  const user = `Write a complete Facebook post about: "${topic}".
Return only the post text (caption), ready to publish.`;
  return generate({ system, user, temperature: 0.85, maxTokens: 600 });
}
