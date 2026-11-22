export interface ModelPricing {
  inputPerM: number;
  outputPerM: number;
  cacheReadPerM: number;
  cacheWritePerM: number;
}

const PRICING_RULES: Array<{ match: RegExp; pricing: ModelPricing }> = [
  // Anthropic Claude family
  {
    match: /opus/i,
    pricing: { inputPerM: 15, outputPerM: 75, cacheReadPerM: 1.5, cacheWritePerM: 18.75 }
  },
  {
    match: /sonnet/i,
    pricing: { inputPerM: 3, outputPerM: 15, cacheReadPerM: 0.3, cacheWritePerM: 3.75 }
  },
  {
    match: /haiku/i,
    pricing: { inputPerM: 0.8, outputPerM: 4, cacheReadPerM: 0.08, cacheWritePerM: 1.0 }
  },
  // OpenAI / Codex family
  {
    match: /gpt-5(?:\.\d+)?-pro|o3-pro/i,
    pricing: { inputPerM: 15, outputPerM: 60, cacheReadPerM: 3.75, cacheWritePerM: 0 }
  },
  {
    match: /gpt-5|codex/i,
    pricing: { inputPerM: 2.5, outputPerM: 10, cacheReadPerM: 0.25, cacheWritePerM: 0 }
  },
  {
    match: /o3|o4-mini/i,
    pricing: { inputPerM: 1.1, outputPerM: 4.4, cacheReadPerM: 0.275, cacheWritePerM: 0 }
  },
  {
    match: /gpt-4\.1/i,
    pricing: { inputPerM: 2, outputPerM: 8, cacheReadPerM: 0.5, cacheWritePerM: 0 }
  },
  // Google Gemini family
  {
    match: /gemini.*flash/i,
    pricing: { inputPerM: 0.15, outputPerM: 0.6, cacheReadPerM: 0.0375, cacheWritePerM: 0 }
  },
  {
    match: /gemini.*pro|gemini-3|gemini-2\.5|gemini-4/i,
    pricing: { inputPerM: 1.25, outputPerM: 10, cacheReadPerM: 0.31, cacheWritePerM: 0 }
  }
];

const DEFAULT_PRICING: ModelPricing = {
  inputPerM: 2,
  outputPerM: 8,
  cacheReadPerM: 0.2,
  cacheWritePerM: 0
};

export function getModelPricing(model: string): ModelPricing {
  const normalized = (model || '').trim();
  for (const rule of PRICING_RULES) {
    if (rule.match.test(normalized)) {
      return rule.pricing;
    }
  }
  return DEFAULT_PRICING;
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number {
  const pricing = getModelPricing(model);
  const safeIn = Math.max(0, inputTokens);
  const safeOut = Math.max(0, outputTokens);
  const safeRead = Math.max(0, cacheReadTokens);
  const safeWrite = Math.max(0, cacheWriteTokens);

  const cost =
    (safeIn * pricing.inputPerM +
      safeOut * pricing.outputPerM +
      safeRead * pricing.cacheReadPerM +
      safeWrite * pricing.cacheWritePerM) /
    1_000_000;

  return Number.isFinite(cost) ? cost : 0;
}
