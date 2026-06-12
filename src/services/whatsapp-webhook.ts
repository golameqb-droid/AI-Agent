import { logger } from "../logger.js";
import { handleIncomingMessage } from "./inbox.js";
import { findVendorByChannelKey } from "./channels.js";

/** Process Meta WhatsApp Cloud API webhook payload. */
export async function processWhatsAppWebhook(body: any): Promise<void> {
  if (body.object !== "whatsapp_business_account") {
    if (body.object) logger.warn(`WhatsApp webhook ignored: object "${body.object}"`);
    return;
  }

  let msgCount = 0;
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== "messages") continue;
      const value = change.value ?? {};
      const phoneNumberId = String(value.metadata?.phone_number_id ?? "");
      const vendorId = findVendorByChannelKey("WA_PHONE_NUMBER_ID", phoneNumberId);
      if (!vendorId) {
        logger.warn(`WhatsApp webhook: no vendor for phone_number_id ${phoneNumberId}`);
        continue;
      }
      for (const msg of value.messages ?? []) {
        if (msg.type !== "text") continue;
        const from = msg.from;
        const text = msg.text?.body;
        const name = value.contacts?.[0]?.profile?.name ?? null;
        const mid = msg.id?.toString();
        if (from && text) {
          msgCount++;
          await handleIncomingMessage(vendorId, "whatsapp", from, text, name, mid);
        }
      }
    }
  }
  if (msgCount) logger.info(`WhatsApp webhook: ${msgCount} message(s) processed`);
}
