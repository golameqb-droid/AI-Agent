import { getSetting, setSetting } from "../db.js";

/** Platform-wide payment gateway credentials — super admin only. */
export const PLATFORM_PAYMENT_KEYS = [
  "BKASH_APP_KEY",
  "BKASH_APP_SECRET",
  "BKASH_USERNAME",
  "BKASH_PASSWORD",
  "BKASH_SANDBOX",
  "BKASH_MERCHANT_NUMBER",
  "NAGAD_MERCHANT_ID",
  "NAGAD_MERCHANT_NUMBER",
  "NAGAD_PUBLIC_KEY",
  "NAGAD_PRIVATE_KEY",
  "NAGAD_SANDBOX",
  "SSLCOMMERZ_STORE_ID",
  "SSLCOMMERZ_STORE_PASS",
  "SSLCOMMERZ_SANDBOX",
  "SALES_EMAIL",
  "SALES_WHATSAPP",
] as const;

export const SECRET_PAYMENT_KEYS = new Set([
  "BKASH_APP_SECRET",
  "BKASH_PASSWORD",
  "NAGAD_PRIVATE_KEY",
  "SSLCOMMERZ_STORE_PASS",
]);

export interface PlatformPaymentConfig {
  bkashAppKey: string;
  bkashAppSecret: string;
  bkashUsername: string;
  bkashPassword: string;
  bkashSandbox: boolean;
  bkashMerchantNumber: string;
  nagadMerchantId: string;
  nagadMerchantNumber: string;
  nagadPublicKey: string;
  nagadPrivateKey: string;
  nagadSandbox: boolean;
  sslcommerzStoreId: string;
  sslcommerzStorePass: string;
  sslcommerzSandbox: boolean;
  salesEmail: string;
  salesWhatsapp: string;
}

function bool(val: string, fallback = false): boolean {
  return ["1", "true", "yes", "on"].includes(val.toLowerCase()) || fallback;
}

function get(key: string, fallback = ""): string {
  return getSetting(key) ?? process.env[key] ?? fallback;
}

export function getPlatformPaymentConfig(): PlatformPaymentConfig {
  return {
    bkashAppKey: get("BKASH_APP_KEY"),
    bkashAppSecret: get("BKASH_APP_SECRET"),
    bkashUsername: get("BKASH_USERNAME"),
    bkashPassword: get("BKASH_PASSWORD"),
    bkashSandbox: bool(get("BKASH_SANDBOX", "true"), true),
    bkashMerchantNumber: get("BKASH_MERCHANT_NUMBER"),
    nagadMerchantId: get("NAGAD_MERCHANT_ID"),
    nagadMerchantNumber: get("NAGAD_MERCHANT_NUMBER"),
    nagadPublicKey: get("NAGAD_PUBLIC_KEY"),
    nagadPrivateKey: get("NAGAD_PRIVATE_KEY"),
    nagadSandbox: bool(get("NAGAD_SANDBOX", "true"), true),
    sslcommerzStoreId: get("SSLCOMMERZ_STORE_ID"),
    sslcommerzStorePass: get("SSLCOMMERZ_STORE_PASS"),
    sslcommerzSandbox: bool(get("SSLCOMMERZ_SANDBOX", "true"), true),
    salesEmail: get("SALES_EMAIL", "sales@socialai.pro"),
    salesWhatsapp: get("SALES_WHATSAPP"),
  };
}

export function setPlatformPaymentSettings(settings: Record<string, string>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (PLATFORM_PAYMENT_KEYS.includes(key as (typeof PLATFORM_PAYMENT_KEYS)[number])) {
      setSetting(key, value);
    }
  }
}

export function paymentsConfigured(): { bkash: boolean; nagad: boolean; sslcommerz: boolean } {
  const c = getPlatformPaymentConfig();
  return {
    bkash: Boolean(c.bkashAppKey && c.bkashAppSecret && c.bkashUsername && c.bkashPassword),
    nagad: Boolean(c.nagadMerchantId && c.nagadPrivateKey),
    sslcommerz: Boolean(c.sslcommerzStoreId && c.sslcommerzStorePass),
  };
}

/** Import payment keys from .env into platform settings on first run. */
export function migratePaymentsToPlatform(): void {
  for (const key of PLATFORM_PAYMENT_KEYS) {
    if (getSetting(key)) continue;
    const envVal = process.env[key];
    if (envVal) setSetting(key, envVal);
  }
}
