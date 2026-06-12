import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getVendorById, setVendorSettings, getVendorSetting } from "./vendor.js";
import { planAllowsChannel } from "./plans.js";
import {
  getPlatformMetaConfig,
  metaAppConfigured,
  metaOAuthRedirectUri,
} from "./platform-meta.js";

const GRAPH = "v21.0";

/** Messenger + comments. business_management required when Page is in Business Manager. */
const MESSENGER_SCOPES = [
  "pages_show_list",
  "pages_messaging",
  "pages_read_engagement",
  "pages_manage_engagement",
  "pages_manage_metadata",
  "business_management",
] as const;

/** Read linked IG/WA during connect — requested on all plans so the page picker can show them. */
const CONNECT_DISCOVERY_SCOPES = [
  "instagram_basic",
  "whatsapp_business_management",
] as const;

/** Build OAuth scopes from vendor plan — messaging scopes only on Pro+. */
export function oauthScopesForVendor(vendorId: number): string {
  const vendor = getVendorById(vendorId);
  const plan = vendor?.plan ?? "trial";
  const scopes = new Set<string>([...MESSENGER_SCOPES, ...CONNECT_DISCOVERY_SCOPES]);
  if (planAllowsChannel(plan, "instagram")) {
    scopes.add("instagram_manage_messages");
    scopes.add("instagram_manage_comments");
  }
  if (planAllowsChannel(plan, "whatsapp")) {
    scopes.add("whatsapp_business_messaging");
  }
  return [...scopes].join(",");
}

export interface MetaPageOption {
  id: string;
  name: string;
  accessToken: string;
  /** User token from OAuth (has WhatsApp scopes); used for WA send/receive setup. */
  userAccessToken?: string;
  instagramAccountId?: string;
  instagramUsername?: string;
  whatsappBusinessAccountId?: string;
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

export function buildMetaOAuthUrl(vendorId: number, returnTo?: string): string {
  if (!metaAppConfigured()) throw new Error("Meta App ID/Secret not configured by admin");
  const { appId } = getPlatformMetaConfig();
  const state = jwt.sign(
    { vendorId, purpose: "meta_oauth", returnTo: returnTo?.slice(0, 512) ?? "" },
    config.platform.jwtSecret,
    { expiresIn: "15m" }
  );
  const redirect = encodeURIComponent(metaOAuthRedirectUri());
  const scope = oauthScopesForVendor(vendorId);
  return `https://www.facebook.com/${GRAPH}/dialog/oauth?client_id=${encodeURIComponent(appId)}&redirect_uri=${redirect}&state=${encodeURIComponent(state)}&scope=${encodeURIComponent(scope)}&response_type=code`;
}

export function verifyOAuthState(state: string): { vendorId: number; returnTo?: string } {
  const payload = jwt.verify(state, config.platform.jwtSecret) as {
    vendorId: number;
    purpose: string;
    returnTo?: string;
  };
  if (payload.purpose !== "meta_oauth") throw new Error("Invalid OAuth state");
  const returnTo = payload.returnTo?.trim();
  return { vendorId: payload.vendorId, returnTo: returnTo || undefined };
}

type WhatsAppLookup = {
  wabaId?: string;
  phoneNumberId?: string;
  displayNumber?: string;
};

async function fetchWhatsAppPhone(wabaId: string, token: string): Promise<WhatsAppLookup> {
  const phones = await graphGet(
    `${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name`,
    token
  );
  const phone = (phones.data ?? [])[0] as
    | { id: string; display_phone_number?: string }
    | undefined;
  if (!phone?.id) return { wabaId };
  return { wabaId, phoneNumberId: phone.id, displayNumber: phone.display_phone_number };
}

async function fetchWhatsAppForPage(
  pageId: string,
  pageToken: string,
  userToken?: string
): Promise<WhatsAppLookup> {
  const pageFields = ["whatsapp_business_account", "connected_whatsapp_business_account"];
  for (const field of pageFields) {
    try {
      const page = await graphGet(`${pageId}?fields=${field}`, pageToken);
      const wabaId = (page[field] as { id?: string } | undefined)?.id;
      if (wabaId) return await fetchWhatsAppPhone(wabaId, pageToken);
    } catch (err: any) {
      logger.warn(`WhatsApp field ${field} failed for page ${pageId}: ${err?.message ?? err}`);
    }
  }
  if (userToken) {
    try {
      const biz = await graphGet(
        "me/businesses?fields=owned_whatsapp_business_accounts{id}",
        userToken
      );
      for (const b of biz.data ?? []) {
        const waba = (b.owned_whatsapp_business_accounts?.data ?? [])[0] as { id?: string } | undefined;
        if (waba?.id) return await fetchWhatsAppPhone(waba.id, userToken);
      }
    } catch (err: any) {
      logger.warn(`WhatsApp business lookup failed: ${err?.message ?? err}`);
    }
  }
  return {};
}

type InstagramLookup = { id?: string; username?: string };

async function fetchInstagramForPage(
  pageId: string,
  pageToken: string,
  userToken: string,
  inline?: { id?: string; username?: string }
): Promise<InstagramLookup> {
  if (inline?.id) return { id: inline.id, username: inline.username };

  const pageFields = [
    "instagram_business_account{id,username}",
    "connected_instagram_account{id,username}",
  ];
  for (const field of pageFields) {
    try {
      const page = await graphGet(`${pageId}?fields=${field}`, pageToken);
      const key = field.split("{")[0] as "instagram_business_account" | "connected_instagram_account";
      const ig = page[key] as { id?: string; username?: string } | undefined;
      if (ig?.id) return { id: ig.id, username: ig.username };
    } catch (err: any) {
      logger.warn(`Instagram field lookup failed for page ${pageId}: ${err?.message ?? err}`);
    }
  }

  try {
    const accounts = await graphGet(`${pageId}/instagram_accounts?fields=id,username`, pageToken);
    const ig = (accounts.data ?? [])[0] as { id?: string; username?: string } | undefined;
    if (ig?.id) return { id: ig.id, username: ig.username };
  } catch (err: any) {
    logger.warn(`Instagram accounts edge failed for page ${pageId}: ${err?.message ?? err}`);
  }

  for (const token of [userToken, pageToken]) {
    try {
      const biz = await graphGet("me/businesses?fields=id,name", token);
      for (const b of biz.data ?? []) {
        try {
          const igList = await graphGet(
            `${b.id}/instagram_business_accounts?fields=id,username`,
            token
          );
          const ig = (igList.data ?? [])[0] as { id?: string; username?: string } | undefined;
          if (ig?.id) {
            logger.info(`Instagram ${ig.id} found via business ${b.id} for page ${pageId}`);
            return { id: ig.id, username: ig.username };
          }
        } catch {
          /* try next business */
        }
      }
    } catch (err: any) {
      logger.warn(`Instagram business lookup failed: ${err?.message ?? err}`);
    }
  }

  return {};
}

async function exchangeLongLivedUserToken(shortToken: string): Promise<string> {
  const { appId, appSecret } = getPlatformMetaConfig();
  const url =
    `https://graph.facebook.com/${GRAPH}/oauth/access_token?grant_type=fb_exchange_token` +
    `&client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}` +
    `&fb_exchange_token=${encodeURIComponent(shortToken)}`;
  const res = await fetch(url);
  const data: any = await res.json();
  if (!res.ok || data.error) return shortToken;
  return (data.access_token as string) || shortToken;
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
  const userToken = await exchangeLongLivedUserToken(tokenData.access_token as string);
  const pagesData = await graphGet(
    "me/accounts?fields=id,name,access_token,instagram_business_account{id,username}",
    userToken
  );
  const pages = (pagesData.data ?? []) as {
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: { id?: string; username?: string };
  }[];
  const out: MetaPageOption[] = [];
  for (const p of pages) {
    const ig = await fetchInstagramForPage(
      p.id,
      p.access_token,
      userToken,
      p.instagram_business_account
    );
    const wa = await fetchWhatsAppForPage(p.id, p.access_token, userToken);
    out.push({
      id: p.id,
      name: p.name,
      accessToken: p.access_token,
      userAccessToken: userToken,
      instagramAccountId: ig.id,
      instagramUsername: ig.username,
      whatsappBusinessAccountId: wa.wabaId,
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

/** Subscribe WhatsApp Business Account to app message webhooks. */
async function subscribeWhatsAppWebhooks(wabaId: string, token: string): Promise<void> {
  const url = `https://graph.facebook.com/${GRAPH}/${wabaId}/subscribed_apps?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: "POST" });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `WhatsApp webhook subscribe failed (${res.status})`);
  }
  logger.info(`WhatsApp Business Account ${wabaId} subscribed to app webhooks`);
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
  if (page.instagramAccountId) {
    updates.IG_ACCOUNT_ID = page.instagramAccountId;
    if (page.instagramUsername) updates.IG_USERNAME = page.instagramUsername;
  }
  if (page.whatsappPhoneNumberId) {
    const waToken = page.userAccessToken || page.accessToken;
    updates.WA_PHONE_NUMBER_ID = page.whatsappPhoneNumberId;
    updates.WA_ACCESS_TOKEN = waToken;
    if (page.userAccessToken) updates.META_USER_ACCESS_TOKEN = page.userAccessToken;
    if (page.whatsappBusinessAccountId) {
      updates.WA_BUSINESS_ACCOUNT_ID = page.whatsappBusinessAccountId;
      try {
        await subscribeWhatsAppWebhooks(page.whatsappBusinessAccountId, waToken);
      } catch (err: any) {
        logger.warn(`WhatsApp webhook subscribe failed: ${err?.message ?? err}`);
      }
    }
  }
  setVendorSettings(vendorId, updates);
  clearPendingPages(vendorId);
  return page;
}
