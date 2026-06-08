import { Router } from "express";
import { requireAuth, requireVendor, type AuthedRequest } from "../middleware/auth.js";
import { config } from "../config.js";
import {
  buildMetaOAuthUrl,
  verifyOAuthState,
  exchangeCodeForPages,
  storePendingPages,
  loadPendingPages,
  applySelectedPage,
} from "../services/meta-oauth.js";
import { metaAppConfigured } from "../services/platform-meta.js";

export const metaRouter = Router();

function vendorId(req: AuthedRequest): number {
  return req.user!.vendorId!;
}

/** Start Meta OAuth — returns redirect URL for vendor. */
metaRouter.get("/oauth/url", requireAuth, requireVendor, (req: AuthedRequest, res) => {
  try {
    const returnTo = req.query.returnTo?.toString();
    const url = buildMetaOAuthUrl(vendorId(req), returnTo);
    res.json({ url, configured: metaAppConfigured() });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/** Facebook redirects here after login (no JWT — state carries vendor id). */
metaRouter.get("/oauth/callback", async (req, res) => {
  const code = req.query.code?.toString();
  const state = req.query.state?.toString();
  const error = req.query.error?.toString();
  const appUrl = `${config.platform.publicBaseUrl.replace(/\/$/, "")}/app`;

  if (error) {
    return res.redirect(`${appUrl}?meta_oauth=denied`);
  }
  if (!code || !state) {
    return res.redirect(`${appUrl}?meta_oauth=error`);
  }

  try {
    const { vendorId, returnTo } = verifyOAuthState(state);
    const pages = await exchangeCodeForPages(code);
    const base =
      returnTo && /^https?:\/\//i.test(returnTo) ? returnTo.replace(/\/$/, "") : appUrl;
    if (!pages.length) {
      return res.redirect(`${base}?meta_oauth=no_pages`);
    }
    storePendingPages(vendorId, pages);
    res.redirect(`${base}?meta_oauth=pages`);
  } catch {
    res.redirect(`${appUrl}?meta_oauth=error`);
  }
});

/** List pages pending selection after OAuth. */
metaRouter.get("/oauth/pages", requireAuth, requireVendor, (req: AuthedRequest, res) => {
  const pages = loadPendingPages(vendorId(req)).map((p) => ({
    id: p.id,
    name: p.name,
    hasInstagram: Boolean(p.instagramAccountId),
    hasWhatsApp: Boolean(p.whatsappPhoneNumberId),
    whatsappDisplayNumber: p.whatsappDisplayNumber ?? null,
  }));
  res.json({ pages, configured: metaAppConfigured() });
});

/** Apply selected Facebook Page (+ Instagram if linked). */
metaRouter.post("/oauth/select", requireAuth, requireVendor, async (req: AuthedRequest, res) => {
  const { pageId } = req.body ?? {};
  if (!pageId) return res.status(400).json({ error: "pageId required" });
  const page = await applySelectedPage(vendorId(req), String(pageId));
  if (!page) return res.status(404).json({ error: "Page not found in pending list" });
  res.json({
    ok: true,
    page: {
      id: page.id,
      name: page.name,
      instagramAccountId: page.instagramAccountId ?? null,
      whatsappPhoneNumberId: page.whatsappPhoneNumberId ?? null,
      whatsappDisplayNumber: page.whatsappDisplayNumber ?? null,
    },
  });
});
