import { logger } from "../logger.js";
import type { VendorConfig } from "./vendor.js";
import { vendorFacebookConfigured } from "./vendor.js";

function graphUrl(cfg: VendorConfig, path: string): string {
  return `https://graph.facebook.com/${cfg.fbGraphVersion}/${path}`;
}

async function graphPost(cfg: VendorConfig, path: string, body: Record<string, unknown>) {
  if (!vendorFacebookConfigured(cfg)) {
    throw new Error("Facebook is not configured for this vendor.");
  }
  const res = await fetch(graphUrl(cfg, path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, access_token: cfg.fbPageAccessToken }),
  });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Facebook API error: ${JSON.stringify(data.error ?? data)}`);
  }
  return data;
}

export async function sendMessage(cfg: VendorConfig, psid: string, text: string) {
  if (!text.trim()) return;
  logger.info(`[vendor ${cfg.vendorId}] Sending Messenger reply to ${psid}`);
  return graphPost(cfg, `${cfg.fbPageId}/messages`, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: { text },
  });
}

/** Send an image attachment in Messenger (imageUrl must be public HTTPS). */
export async function sendImage(cfg: VendorConfig, psid: string, imageUrl: string) {
  logger.info(`[vendor ${cfg.vendorId}] Sending image to ${psid}`);
  return graphPost(cfg, `${cfg.fbPageId}/messages`, {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: {
      attachment: {
        type: "image",
        payload: { url: imageUrl, is_reusable: true },
      },
    },
  });
}

export async function replyToComment(cfg: VendorConfig, commentId: string, text: string) {
  logger.info(`[vendor ${cfg.vendorId}] Replying to comment ${commentId}`);
  return graphPost(cfg, `${commentId}/comments`, { message: text });
}

export async function publishPost(cfg: VendorConfig, message: string, link?: string | null) {
  const body: Record<string, unknown> = { message };
  if (link) body.link = link;
  return graphPost(cfg, `${cfg.fbPageId}/feed`, body);
}

export async function publishPhoto(cfg: VendorConfig, imageUrl: string, caption: string) {
  return graphPost(cfg, `${cfg.fbPageId}/photos`, { url: imageUrl, caption });
}

export async function getUserName(cfg: VendorConfig, psid: string): Promise<string | null> {
  if (!vendorFacebookConfigured(cfg)) return null;
  try {
    const res = await fetch(
      graphUrl(cfg, `${psid}?fields=name&access_token=${cfg.fbPageAccessToken}`)
    );
    const data: any = await res.json();
    return data?.name ?? null;
  } catch {
    return null;
  }
}
