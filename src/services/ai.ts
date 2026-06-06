import { logger } from "../logger.js";
import type { AiResult } from "../types.js";
import type { VendorConfig } from "./vendor.js";
import { vendorAiConfigured } from "./vendor.js";
import { recordAiTokenUsage } from "./ai-usage.js";

interface GenerateOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
  purpose?: string;
}

async function callGemini(cfg: VendorConfig, opts: GenerateOptions): Promise<AiResult> {
  const { geminiApiKey: apiKey, geminiModel: model } = cfg;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.7,
      maxOutputTokens: opts.maxTokens ?? 800,
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Gemini error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  const usage = data?.usageMetadata ?? {};
  return {
    text: text.trim(),
    provider: "gemini",
    model,
    tokensIn: usage.promptTokenCount ?? 0,
    tokensOut: usage.candidatesTokenCount ?? 0,
  };
}

async function callGroq(cfg: VendorConfig, opts: GenerateOptions): Promise<AiResult> {
  const { groqApiKey: apiKey, groqModel: model } = cfg;
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: opts.temperature ?? 0.7,
      max_tokens: opts.maxTokens ?? 800,
    }),
  });
  if (!res.ok) throw new Error(`Groq error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const usage = data?.usage ?? {};
  return {
    text: (data?.choices?.[0]?.message?.content ?? "").trim(),
    provider: "groq",
    model,
    tokensIn: usage.prompt_tokens ?? 0,
    tokensOut: usage.completion_tokens ?? 0,
  };
}

async function callAnthropic(cfg: VendorConfig, opts: GenerateOptions): Promise<AiResult> {
  const { anthropicApiKey: apiKey, anthropicModel: model } = cfg;
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: opts.maxTokens ?? 800,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic error ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  const text = data?.content?.map((b: any) => b.text).join("") ?? "";
  const usage = data?.usage ?? {};
  return {
    text: text.trim(),
    provider: "anthropic",
    model,
    tokensIn: usage.input_tokens ?? 0,
    tokensOut: usage.output_tokens ?? 0,
  };
}

/** Vendor-scoped AI text generation. */
export async function generateForVendor(
  cfg: VendorConfig,
  opts: GenerateOptions
): Promise<AiResult> {
  if (!vendorAiConfigured(cfg)) {
    throw new Error(
      `AI provider "${cfg.aiProvider}" is not configured. Add the API key in your dashboard.`
    );
  }
  try {
    let result: AiResult;
    if (cfg.aiProvider === "groq") result = await callGroq(cfg, opts);
    else if (cfg.aiProvider === "anthropic") result = await callAnthropic(cfg, opts);
    else result = await callGemini(cfg, opts);
    recordAiTokenUsage(cfg.vendorId, result, opts.purpose);
    return result;
  } catch (err) {
    logger.error("AI generation failed", err);
    throw err;
  }
}
