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

export async function sendMessage(
  cfg: VendorConfig,
  psid: string,
  text: string,
  channel: "messenger" | "instagram" = "messenger"
) {
  if (!text.trim()) return;
  logger.info(`[vendor ${cfg.vendorId}] Sending ${channel} reply to ${psid}`);
  const body: Record<string, unknown> = {
    recipient: { id: psid },
    messaging_type: "RESPONSE",
    message: { text },
  };
  if (channel === "instagram") body.messaging_product = "instagram";
  return graphPost(cfg, `${cfg.fbPageId}/messages`, body);
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

function isInstagramCommentId(commentId: string): boolean {
  return !commentId.includes("_");
}

export async function replyToComment(cfg: VendorConfig, commentId: string, text: string) {
  const ig = isInstagramCommentId(commentId);
  logger.info(`[vendor ${cfg.vendorId}] Replying to ${ig ? "Instagram" : "Facebook"} comment ${commentId}`);
  if (ig) {
    return graphPost(cfg, `${commentId}/replies`, { message: text });
  }
  return graphPost(cfg, `${commentId}/comments`, { message: text });
}

/** Hide/remove a negative comment (FB Page or Instagram). */
export async function deleteComment(cfg: VendorConfig, commentId: string): Promise<boolean> {
  if (!vendorFacebookConfigured(cfg)) return false;
  if (isInstagramCommentId(commentId)) {
    return graphPost(cfg, commentId, { hide: true }).then(() => {
      logger.info(`[vendor ${cfg.vendorId}] Hid Instagram comment ${commentId}`);
      return true;
    });
  }
  const url = graphUrl(cfg, `${commentId}?access_token=${encodeURIComponent(cfg.fbPageAccessToken)}`);
  const res = await fetch(url, { method: "DELETE" });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok || data.error) {
    throw new Error(`Facebook delete comment error: ${JSON.stringify(data.error ?? data)}`);
  }
  logger.info(`[vendor ${cfg.vendorId}] Deleted comment ${commentId}`);
  return data.success === true;
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
