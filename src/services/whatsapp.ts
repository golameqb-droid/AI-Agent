import { logger } from "../logger.js";
import type { VendorConfig } from "./vendor.js";
import { getVendorSetting } from "./vendor.js";

function waConfigured(cfg: VendorConfig): boolean {
  return Boolean(getVendorSetting(cfg.vendorId, "WA_PHONE_NUMBER_ID") && getVendorSetting(cfg.vendorId, "WA_ACCESS_TOKEN"));
}

export async function sendWhatsAppMessage(cfg: VendorConfig, to: string, text: string) {
  if (!text.trim()) return;
  const phoneId = getVendorSetting(cfg.vendorId, "WA_PHONE_NUMBER_ID");
  const token = getVendorSetting(cfg.vendorId, "WA_ACCESS_TOKEN");
  if (!phoneId || !token) throw new Error("WhatsApp is not configured for this vendor.");

  const version = cfg.fbGraphVersion || "v21.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "text",
      text: { body: text },
    }),
  });
  const data: any = await res.json();
  if (!res.ok || data.error) throw new Error(`WhatsApp API error: ${JSON.stringify(data.error ?? data)}`);
  logger.info(`[vendor ${cfg.vendorId}] WhatsApp message sent to ${to}`);
  return data;
}

export async function sendWhatsAppImage(cfg: VendorConfig, to: string, imageUrl: string) {
  const phoneId = getVendorSetting(cfg.vendorId, "WA_PHONE_NUMBER_ID");
  const token = getVendorSetting(cfg.vendorId, "WA_ACCESS_TOKEN");
  if (!phoneId || !token) throw new Error("WhatsApp is not configured for this vendor.");

  const version = cfg.fbGraphVersion || "v21.0";
  const res = await fetch(`https://graph.facebook.com/${version}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to.replace(/\D/g, ""),
      type: "image",
      image: { link: imageUrl },
    }),
  });
  const data: any = await res.json();
  if (!res.ok || data.error) throw new Error(`WhatsApp API error: ${JSON.stringify(data.error ?? data)}`);
  return data;
}

export function vendorWhatsAppConfigured(cfg: VendorConfig): boolean {
  return waConfigured(cfg);
}
