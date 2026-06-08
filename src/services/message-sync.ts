import { db } from "../db.js";
import { logger } from "../logger.js";
import { handleIncomingMessage } from "./inbox.js";
import { getVendorConfig, vendorFacebookConfigured } from "./vendor.js";

/** Poll Page conversations when Meta message webhooks don't arrive. */
export async function syncVendorMessages(vendorId: number): Promise<number> {
  const cfg = getVendorConfig(vendorId);
  if (!vendorFacebookConfigured(cfg)) return 0;

  const token = encodeURIComponent(cfg.fbPageAccessToken);
  const convUrl =
    `https://graph.facebook.com/${cfg.fbGraphVersion}/${cfg.fbPageId}/conversations` +
    `?fields=participants,updated_time&limit=25&access_token=${token}`;

  const convRes = await fetch(convUrl);
  const convData: any = await convRes.json();
  if (!convRes.ok || convData.error) {
    logger.warn(`[vendor ${vendorId}] Message sync: ${convData.error?.message ?? convRes.status}`);
    return 0;
  }

  let synced = 0;
  for (const conv of convData.data ?? []) {
    const convId = String(conv.id ?? "");
    if (!convId) continue;

    const participants = (conv.participants?.data ?? []) as { id: string; name?: string }[];
    const customer = participants.find((p) => String(p.id) !== cfg.fbPageId);
    if (!customer?.id) continue;

    const psid = String(customer.id);
    const msgUrl =
      `https://graph.facebook.com/${cfg.fbGraphVersion}/${convId}/messages` +
      `?fields=id,message,from,created_time&limit=20&access_token=${token}`;

    const msgRes = await fetch(msgUrl);
    const msgData: any = await msgRes.json();
    if (!msgRes.ok || msgData.error) {
      logger.warn(`[vendor ${vendorId}] Message sync conv ${convId}: ${msgData.error?.message ?? msgRes.status}`);
      continue;
    }

    for (const m of msgData.data ?? []) {
      const fromId = String(m.from?.id ?? "");
      if (fromId === cfg.fbPageId) continue;

      const text = String(m.message ?? "").trim();
      const mid = String(m.id ?? "");
      if (!text || !mid) continue;

      const exists = db.prepare("SELECT id FROM messages WHERE fb_mid = ?").get(mid);
      if (exists) continue;

      const createdMs = m.created_time ? Date.parse(m.created_time) : Date.now();
      const withinReplyWindow = Date.now() - createdMs < 23 * 60 * 60 * 1000;
      await handleIncomingMessage(
        vendorId,
        "messenger",
        psid,
        text,
        customer.name ?? null,
        mid,
        withinReplyWindow
      );
      synced++;
    }
  }

  if (synced > 0) logger.info(`[vendor ${vendorId}] Synced ${synced} new message(s) from Graph API`);
  return synced;
}

export async function syncAllVendorMessages(): Promise<void> {
  const vendors = db
    .prepare(
      "SELECT DISTINCT vendor_id FROM vendor_settings WHERE key = 'FB_PAGE_ID' AND value != ''"
    )
    .all() as { vendor_id: number }[];

  for (const { vendor_id } of vendors) {
    try {
      await syncVendorMessages(vendor_id);
    } catch (err) {
      logger.error(`[vendor ${vendor_id}] Message sync failed`, err);
    }
  }
}
