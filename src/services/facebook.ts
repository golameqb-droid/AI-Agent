import { config, facebookConfigured } from "../config.js";
import { logger } from "../logger.js";

function graphUrl(path: string): string {
  return `https://graph.facebook.com/${config.facebook.graphVersion}/${path}`;
}

async function graphPost(path: string, body: Record<string, unknown>) {
  if (!facebookConfigured()) {
    throw new Error(
      "Facebook is not configured. Add FB_PAGE_ID and FB_PAGE_ACCESS_TOKEN in your .env file."
    );
  }
  const res = await fetch(graphUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: config.facebook.pageAccessToken }),
  });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Facebook API error: ${JSON.stringify(data.error ?? data)}`);
  }
  return data;
}

/** Send a private message (reply) to a customer on Messenger. */
export async function sendMessage(psid: string, text: string) {
  logger.info(`Sending Messenger reply to ${psid}`);
  return graphPost(`${config.facebook.pageId}/messages`, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: { text },
  });
}

/** Reply publicly to a comment. */
export async function replyToComment(commentId: string, text: string) {
  logger.info(`Replying to comment ${commentId}`);
  return graphPost(`${commentId}/comments`, { message: text });
}

/** Publish a text post (optionally with a link) to the page feed. */
export async function publishPost(message: string, link?: string | null) {
  logger.info("Publishing text post to page feed");
  const body: Record<string, unknown> = { message };
  if (link) body.link = link;
  return graphPost(`${config.facebook.pageId}/feed`, body);
}

/** Publish a photo post (image by URL) with a caption. */
export async function publishPhoto(imageUrl: string, caption: string) {
  logger.info("Publishing photo post to page");
  return graphPost(`${config.facebook.pageId}/photos`, {
    url: imageUrl,
    caption,
  });
}

/** Fetch the sender's display name for nicer replies (best-effort). */
export async function getUserName(psid: string): Promise<string | null> {
  if (!facebookConfigured()) return null;
  try {
    const res = await fetch(
      graphUrl(`${psid}?fields=name&access_token=${config.facebook.pageAccessToken}`)
    );
    const data: any = await res.json();
    return data?.name ?? null;
  } catch {
    return null;
  }
}
