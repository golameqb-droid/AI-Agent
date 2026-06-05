import { config, aiConfigured } from "../config.js";
import { logger } from "../logger.js";
import type { AiResult } from "../types.js";

interface GenerateOptions {
  system: string;
  user: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Calls Google Gemini (free tier). Docs:
 * https://ai.google.dev/api/generate-content
 */
async function callGemini(opts: GenerateOptions): Promise<AiResult> {
  const { apiKey, model } = config.ai.gemini;
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

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Gemini error ${res.status}: ${detail}`);
  }

  const data: any = await res.json();
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
  return { text: text.trim(), provider: "gemini", model };
}

/**
 * Calls Groq (free, OpenAI-compatible). Docs:
 * https://console.groq.com/docs/api-reference
 */
async function callGroq(opts: GenerateOptions): Promise<AiResult> {
  const { apiKey, model } = config.ai.groq;
  const url = "https://api.groq.com/openai/v1/chat/completions";

  const body = {
    model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 800,
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Groq error ${res.status}: ${detail}`);
  }

  const data: any = await res.json();
  const text = data?.choices?.[0]?.message?.content ?? "";
  return { text: text.trim(), provider: "groq", model };
}

/** Provider-agnostic text generation. */
export async function generate(opts: GenerateOptions): Promise<AiResult> {
  if (!aiConfigured()) {
    throw new Error(
      `AI provider "${config.ai.provider}" is not configured. Add the API key in your .env file.`
    );
  }

  try {
    if (config.ai.provider === "groq") return await callGroq(opts);
    return await callGemini(opts);
  } catch (err) {
    logger.error("AI generation failed", err);
    throw err;
  }
}
