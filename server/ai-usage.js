const tokenCount = (...values) => values.find(value => Number.isSafeInteger(value) && value >= 0) ?? null;

export function normalizeUsage(usage) {
  const inputTokens = tokenCount(usage?.input_tokens, usage?.prompt_tokens);
  const outputTokens = tokenCount(usage?.output_tokens, usage?.completion_tokens);
  let cachedInputTokens = tokenCount(usage?.input_tokens_details?.cached_tokens, usage?.prompt_tokens_details?.cached_tokens, usage?.prompt_cache_hit_tokens);
  if (inputTokens !== null && cachedInputTokens > inputTokens) cachedInputTokens = null;
  return { inputTokens, outputTokens, cachedInputTokens };
}

export function usageMeta(usages) {
  const usage = Object.fromEntries(['inputTokens', 'outputTokens', 'cachedInputTokens'].map(key => {
    const values = usages.map(item => item[key]);
    const total = values.length && values.every(value => value !== null) ? tokenCount(values.reduce((sum, value) => sum + value, 0)) : null;
    return [key, total];
  }));
  return {
    usage,
    cache: {
      hit: usage.cachedInputTokens === null ? null : usage.cachedInputTokens > 0,
      inputTokenHitRate: usage.cachedInputTokens !== null && usage.inputTokens > 0 ? usage.cachedInputTokens / usage.inputTokens : null,
    },
  };
}
