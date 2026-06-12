import { logger } from "../logger.js";
import type { VendorConfig } from "./vendor.js";
import { getVendorSetting, setVendorSettings } from "./vendor.js";

const GRAPH = "v25.0";

function waToken(cfg: VendorConfig): string | null {
  return (
    getVendorSetting(cfg.vendorId, "WA_ACCESS_TOKEN") ||
    getVendorSetting(cfg.vendorId, "META_USER_ACCESS_TOKEN") ||
    null
  );
}

function waPhoneId(cfg: VendorConfig): string | null {
  return getVendorSetting(cfg.vendorId, "WA_PHONE_NUMBER_ID") || null;
}

async function graphPost(
  path: string,
  token: string,
  body?: Record<string, unknown>
): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await fetch(`https://graph.facebook.com/${GRAPH}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  return { ok: res.ok && !data.error, status: res.status, data };
}

export type WhatsAppPhoneStatus = {
  configured: boolean;
  phoneNumberId: string | null;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  status: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  qualityRating: string | null;
  ready: boolean;
  otpBlocked: boolean;
  otpBlockReason: string | null;
  nextStep: string;
};

export async function getWhatsAppPhoneStatus(cfg: VendorConfig): Promise<WhatsAppPhoneStatus> {
  const phoneId = waPhoneId(cfg);
  const token = waToken(cfg);
  if (!phoneId || !token) {
    return {
      configured: false,
      phoneNumberId: phoneId,
      displayPhoneNumber: null,
      verifiedName: null,
      status: null,
      codeVerificationStatus: null,
      nameStatus: null,
      qualityRating: null,
      ready: false,
      otpBlocked: false,
      otpBlockReason: null,
      nextStep: "Connect Facebook Page with WhatsApp or paste Phone Number ID + token.",
    };
  }

  const fields =
    "display_phone_number,verified_name,status,code_verification_status,name_status,quality_rating";
  const res = await fetch(
    `https://graph.facebook.com/${GRAPH}/${phoneId}?fields=${fields}&access_token=${encodeURIComponent(token)}`
  );
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? `WhatsApp status check failed (${res.status})`);
  }

  const codeStatus = (data.code_verification_status as string) ?? "UNKNOWN";
  const status = (data.status as string) ?? "UNKNOWN";
  const ready = codeStatus === "VERIFIED" && status === "CONNECTED";

  const blockedAt = getVendorSetting(cfg.vendorId, "WA_OTP_BLOCKED_AT");
  const blockedReason = getVendorSetting(cfg.vendorId, "WA_OTP_BLOCK_REASON");
  const blockedMs = blockedAt ? Date.parse(blockedAt) : NaN;
  const otpBlocked =
    codeStatus !== "VERIFIED" &&
    Number.isFinite(blockedMs) &&
    Date.now() - blockedMs < 72 * 60 * 60 * 1000;
  const otpBlockReason = otpBlocked
    ? blockedReason ||
      "Meta rate-limited OTP for this number. Stop requesting codes for ~72 hours, or use a different phone number."
    : null;

  let nextStep = "Send and receive messages.";
  if (otpBlocked) {
    nextStep = otpBlockReason ?? "OTP temporarily blocked by Meta.";
  } else if (codeStatus !== "VERIFIED") {
    nextStep = "Verify phone ownership with SMS/voice code, then register with a 6-digit PIN.";
  } else if (status !== "CONNECTED") {
    nextStep = "Register this number for Cloud API with a 6-digit PIN.";
  }

  return {
    configured: true,
    phoneNumberId: phoneId,
    displayPhoneNumber: data.display_phone_number ?? null,
    verifiedName: data.verified_name ?? null,
    status,
    codeVerificationStatus: codeStatus,
    nameStatus: data.name_status ?? null,
    qualityRating: data.quality_rating ?? null,
    ready,
    otpBlocked,
    otpBlockReason,
    nextStep,
  };
}

export async function requestWhatsAppCode(
  cfg: VendorConfig,
  method: "SMS" | "VOICE" = "SMS"
): Promise<{ success: boolean; message: string }> {
  const phoneId = waPhoneId(cfg);
  const token = waToken(cfg);
  if (!phoneId || !token) throw new Error("WhatsApp is not configured.");

  const { ok, data } = await graphPost(
    `${phoneId}/request_code?code_method=${method}&language=en_US`,
    token
  );
  if (!ok) {
    const sub = data.error?.error_subcode;
    const userMsg = data.error?.error_user_msg ?? data.error?.message ?? "Failed to request code";
    if (sub === 2388367 || String(userMsg).toLowerCase().includes("too many")) {
      setVendorSettings(cfg.vendorId, {
        WA_OTP_BLOCKED_AT: new Date().toISOString(),
        WA_OTP_BLOCK_REASON:
          "Meta rate-limited OTP for this number. Wait ~72 hours with no attempts, or use a different phone number.",
      });
    }
    throw new Error(userMsg);
  }
  logger.info(`[vendor ${cfg.vendorId}] WhatsApp verification code requested via ${method}`);
  return {
    success: true,
    message: `Verification code sent via ${method} to your business number.`,
  };
}

export async function verifyWhatsAppCode(
  cfg: VendorConfig,
  code: string
): Promise<{ success: boolean; message: string }> {
  const phoneId = waPhoneId(cfg);
  const token = waToken(cfg);
  if (!phoneId || !token) throw new Error("WhatsApp is not configured.");
  const trimmed = code.replace(/\D/g, "");
  if (trimmed.length < 4) throw new Error("Enter the verification code from SMS or voice call.");

  const { ok, data } = await graphPost(`${phoneId}/verify_code?code=${encodeURIComponent(trimmed)}`, token);
  if (!ok) {
    const msg = data.error?.error_user_msg ?? data.error?.message ?? "Verification failed";
    throw new Error(msg);
  }
  setVendorSettings(cfg.vendorId, { WA_OTP_BLOCKED_AT: "", WA_OTP_BLOCK_REASON: "" });
  logger.info(`[vendor ${cfg.vendorId}] WhatsApp phone verified`);
  return { success: true, message: "Phone verified. Now register with your 6-digit PIN." };
}

export async function registerWhatsAppPhone(
  cfg: VendorConfig,
  pin: string
): Promise<{ success: boolean; message: string }> {
  const phoneId = waPhoneId(cfg);
  const token = waToken(cfg);
  if (!phoneId || !token) throw new Error("WhatsApp is not configured.");
  const trimmed = pin.replace(/\D/g, "");
  if (trimmed.length !== 6) throw new Error("PIN must be exactly 6 digits.");

  const { ok, data } = await graphPost(`${phoneId}/register`, token, {
    messaging_product: "whatsapp",
    pin: trimmed,
  });
  if (!ok) {
    const msg = data.error?.error_user_msg ?? data.error?.message ?? "Registration failed";
    throw new Error(msg);
  }
  logger.info(`[vendor ${cfg.vendorId}] WhatsApp phone registered for Cloud API`);
  return { success: true, message: "WhatsApp registered. Send a test message to your business number." };
}

export async function resubscribeWhatsAppWebhooks(cfg: VendorConfig): Promise<void> {
  const wabaId = getVendorSetting(cfg.vendorId, "WA_BUSINESS_ACCOUNT_ID");
  const token = waToken(cfg);
  if (!wabaId || !token) throw new Error("WhatsApp Business Account ID not found. Reconnect Facebook Page.");

  const url = `https://graph.facebook.com/${GRAPH}/${wabaId}/subscribed_apps?access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, { method: "POST" });
  const data: any = await res.json();
  if (!res.ok || data.error) {
    throw new Error(data.error?.message ?? "Webhook subscribe failed");
  }
  logger.info(`[vendor ${cfg.vendorId}] WhatsApp WABA ${wabaId} resubscribed to app webhooks`);
}
