import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { setVendorSettings, getVendorSetting } from "./vendor.js";
import {
  getPlatformMetaConfig,
  metaAppConfigured,
  metaOAuthRedirectUri,
} from "./platform-meta.js";

const GRAPH = "v21.0";
const SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "instagram_basic",
  "instagram_manage_messages",
  "business_management",
  "whatsapp_business_management",
  "whatsapp_business_messaging",
].join(",");

export interface MetaPageOption {
  id: string;
  name: string;
  accessToken: string;
  instagramAccountId?: string;
  whatsappPhoneNumberId?: string;
  whatsappDisplayNumber?: string;
}

function graphGet(path: string, token: string): Promise<any> {
  const url = `https://graph.facebook.com/${GRAPH}/${path}${path.includes("?") ? "&" : "?"}access_token=${encodeURIComponent(token)}`;
  return fetch(url).then(async (res) => {
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message ?? `Graph error ${res.status}`);
    return data;
  });
}

export function buildMetaOAuthUrl(vendorId: number): string {
  if (!metaAppConfigured()) throw new Error("Meta App ID/Secret not configured by admin");
  const { appId } = getPlatformMetaConfig();
  const state = jwt.sign({ vendorId, purpose: "meta_oauth" }, config.platform.jwtSecret, {
    expiresIn: "15m",
  });
  const redirect = encodeURIComponent(metaOAuthRedirectUri());
  return `https://www.facebook.com/${GRAPH}/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${redirect}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(SCOPES)}&response_type=code`;
}

export function verifyOAuthState(state: string): number {
  const payload = jwt.verify(state, config.platform.jwtSecret) as { vendorId: number; purpose: string };
  if (payload.purpose !== "meta_oauth") throw new Error("Invalid OAuth state");
  return payload.vendorId;
}

async function fetchWhatsAppForPage(
  pageId: string,
  pageToken: string
): Promise<{ phoneNumberId?: string; displayNumber?: string }> {
  const fields = "connected_whatsapp_business_account{id}";
  try {
    const page = await graphGet(`${pageId}?fields=${fields}`, pageToken);
    const wabaId = page.connected_whatsapp_business_account?.id as string | undefined;
    if (!wabaId) return {};
    const phones = await graphGet(
      `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
      pageToken
    );
    const phone = (phones.data ?? [])[0] as
      | { id: string; display_phone_number?: string }
      | undefined;
    if (!phone?.id) return {};
    return { phoneNumberId: phone.id, displayNumber: phone.display_phone_number };
  } catch {
    return {};
  }
}

export async function exchangeCodeForPages(code: string): Promise<MetaPageOption[]> {
  const { appId, appSecret } = getPlatformMetaConfig();
  const redirect = encodeURIComponent(metaOAuthRedirectUri());
  const tokenUrl = `https://graph.facebook.com/${GRAPH}/oauth/access_token?client_id=${appId}&redirect_uri=${redirect}&client_secret=${encodeURIComponent(appSecret)}&code=${encodeURIComponent(code)}`;
  const tokenRes = await fetch(tokenUrl);
  const tokenData: any = await tokenRes.json();
  if (!tokenRes.ok || tokenData.error) {
    throw new Error(tokenData.error?.message ?? "Failed to exchange OAuth code");
  }
  const userToken = tokenData.access_token as string;
  const pagesData = await graphGet("me/accounts?fields=id,name,access_token", userToken);
  const pages = (pagesData.data ?? []) as { id: string; name: string; access_token: string }[];
  const out: MetaPageOption[] = [];
  for (const p of pages) {
    let instagramAccountId: string | undefined;
    try {
      const ig = await graphGet(`${p.id}?fields=instagram_business_account`, p.access_token);
      instagramAccountId = ig.instagram_business_account?.id;
    } catch {
      /* page may not have IG */
    }
    const wa = await fetchWhatsAppForPage(p.id, p.access_token);
    out.push({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      instagramAccountId,
      whatsappPhoneNumberId: wa.phoneNumberId,
      whatsappDisplayNumber: wa.displayNumber,
    });
  }
  return out;
}

export function storePendingPages(vendorId: number, pages: MetaPageOption[]): void {
  setVendorSettings(vendorId, {
    META_OAUTH_PENDING_PAGES: JSON.stringify(pages),
  });
}

export function loadPendingPages(vendorId: number): MetaPageOption[] {
  const raw = getVendorSetting(vendorId, "META_OAUTH_PENDING_PAGES");
  if (!raw) return [];
  try {
    return JSON.parse(raw) as MetaPageOption[];
  } catch {
    return [];
  }
}

export function clearPendingPages(vendorId: number): void {
  setVendorSettings(vendorId, { META_OAUTH_PENDING_PAGES: "" });
}

/** Subscribe Page to app webhooks (messages, postbacks, comments). */
async function subscribePageWebhooks(pageId: string, pageToken: string): Promise<void> {
  const fields = ["messages", "messaging_postbacks", "feed"].join(",");
  const url = `https://graph.facebook.com/${GRAPH}/${pageId}/subscribed_apps?subscribed_fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageToken)}`;
  const res = await fetch(url, { method: "POST" });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `Page webhook subscribe failed (${res.status})`);
  }
}

export async function applySelectedPage(vendorId: number, pageId: string): Promise<MetaPageOption | null> {
  const pages = loadPendingPages(vendorId);
  const page = pages.find((p) => p.id === pageId);
  if (!page) return null;
  await subscribePageWebhooks(page.id, page.accessToken);
  const updates: Record<string, string> = {
    FB_PAGE_ID: page.id,
    FB_PAGE_ACCESS_TOKEN: page.accessToken,
    FB_GRAPH_VERSION: GRAPH,
  };
  if (page.instagramAccountId) updates.IG_ACCOUNT_ID = page.instagramAccountId;
  if (page.whatsappPhoneNumberId) {
    updates.WA_PHONE_NUMBER_ID = page.whatsappPhoneNumberId;
    updates.WA_ACCESS_TOKEN = page.accessToken;
  }
  setVendorSettings(vendorId, updates);
  clearPendingPages(vendorId);
  return page;
}
