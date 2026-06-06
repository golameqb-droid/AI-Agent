/** Rough USD pricing per 1M tokens (input / output) for cost estimates. */
const RATES: Record<string, { in: number; out: number }> = {
  "gemini-2.0-flash": { in: 0.1, out: 0.4 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
  "gemini-1.5-pro": { in: 1.25, out: 5.0 },
  "llama-3.3-70b-versatile": { in: 0.59, out: 0.79 },
  "llama-3.1-8b-instant": { in: 0.05, out: 0.08 },
  "mixtral-8x7b-32768": { in: 0.24, out: 0.24 },
  "claude-3-5-haiku-20241022": { in: 0.8, out: 4.0 },
  "claude-3-5-sonnet-20241022": { in: 3.0, out: 15.0 },
  default: { in: 0.5, out: 1.5 },
};

export function estimateTokenCostUsd(
  provider: string,
  model: string,
  tokensIn: number,
  tokensOut: number
): number {
  const key = model.toLowerCase();
  const rates =
    RATES[key] ??
    (provider === "gemini"
      ? RATES["gemini-1.5-flash"]
      : provider === "groq"
        ? RATES["llama-3.3-70b-versatile"]
        : provider === "anthropic"
          ? RATES["claude-3-5-haiku-20241022"]
          : RATES.default);
  const cost = (tokensIn / 1_000_000) * rates.in + (tokensOut / 1_000_000) * rates.out;
  return Math.round(cost * 1_000_000) / 1_000_000;
}
