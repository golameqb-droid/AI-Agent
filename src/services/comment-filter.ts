import type { VendorConfig } from "./vendor.js";
import { getVendorSetting } from "./vendor.js";

function normHandle(value: string): string {
  return value.replace(/^@/, "").trim().toLowerCase();
}

/** Skip comments posted by the vendor's own Page or Instagram account (avoids reply loops). */
export function isOwnSocialComment(
  vendorId: number,
  cfg: VendorConfig,
  opts: { fromId?: string | null; fromName?: string | null }
): boolean {
  const fromId = opts.fromId ? String(opts.fromId) : "";
  if (fromId) {
    if (fromId === cfg.fbPageId) return true;
    const igId = getVendorSetting(vendorId, "IG_ACCOUNT_ID");
    if (igId && fromId === igId) return true;
  }

  const handle = normHandle(opts.fromName ?? "");
  if (!handle) return false;

  const igUser = normHandle(getVendorSetting(vendorId, "IG_USERNAME") ?? "");
  if (igUser && handle === igUser) return true;

  return false;
}
