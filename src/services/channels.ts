import { db } from "../db.js";
import { logger } from "../logger.js";
import { sendMessage, sendImage } from "./facebook.js";
import { sendWhatsAppMessage, sendWhatsAppImage } from "./whatsapp.js";
import type { VendorConfig } from "./vendor.js";
import { getVendorSetting } from "./vendor.js";
import { planAllowsChannel, type ChannelId } from "./plans.js";
import { getVendorById } from "./vendor.js";

export type Channel = ChannelId;

export const CHANNEL_LABELS: Record<Channel, string> = {
  messenger: "Messenger",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
};

export const CHANNEL_ICONS: Record<Channel, string> = {
  messenger: "💬",
  whatsapp: "📱",
  instagram: "📸",
};

export async function sendText(
  cfg: VendorConfig,
  channel: Channel,
  userId: string,
  text: string
): Promise<void> {
  if (!text.trim()) return;
  switch (channel) {
    case "whatsapp":
      await sendWhatsAppMessage(cfg, userId, text);
      break;
    case "instagram":
      await sendMessage(cfg, userId, text, "instagram");
      break;
    case "messenger":
    default:
      await sendMessage(cfg, userId, text, "messenger");
      break;
  }
}

export async function sendChannelImage(
  cfg: VendorConfig,
  channel: Channel,
  userId: string,
  imageUrl: string
): Promise<void> {
  switch (channel) {
    case "whatsapp":
      await sendWhatsAppImage(cfg, userId, imageUrl);
      break;
    case "instagram":
    case "messenger":
    default:
      await sendImage(cfg, userId, imageUrl);
      break;
  }
}

export function channelConfigured(cfg: VendorConfig, channel: Channel): boolean {
  switch (channel) {
    case "whatsapp":
      return Boolean(
        getVendorSetting(cfg.vendorId, "WA_PHONE_NUMBER_ID") &&
          (getVendorSetting(cfg.vendorId, "WA_ACCESS_TOKEN") ||
            getVendorSetting(cfg.vendorId, "META_USER_ACCESS_TOKEN"))
      );
    case "instagram":
      return Boolean(getVendorSetting(cfg.vendorId, "IG_ACCOUNT_ID") && cfg.fbPageAccessToken);
    case "messenger":
    default:
      return Boolean(cfg.fbPageId && cfg.fbPageAccessToken);
  }
}

export function vendorCanUseChannel(vendorId: number, channel: Channel): boolean {
  const vendor = getVendorById(vendorId);
  if (!vendor) return false;
  return planAllowsChannel(vendor.plan, channel);
}

export function findVendorByChannelKey(key: string, value: string): number | null {
  const row = db
    .prepare("SELECT vendor_id FROM vendor_settings WHERE key = ? AND value = ?")
    .get(key, value) as { vendor_id: number } | undefined;
  return row?.vendor_id ?? null;
}

export function logChannel(vendorId: number, channel: Channel, action: string) {
  logger.info(`[vendor ${vendorId}] [${channel}] ${action}`);
}
