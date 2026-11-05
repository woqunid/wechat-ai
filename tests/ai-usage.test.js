import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeUsage, usageMeta } from '../server/ai-usage.js';

const unknown = { inputTokens: null, outputTokens: null, cachedInputTokens: null };

test('兼容两种接口和服务商缓存字段，零命中保留为0', () => {
  for (const usage of [
    { input_tokens: 1000, output_tokens: 80, input_tokens_details: { cached_tokens: 700 } },
    { prompt_tokens: 1000, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 700 } },
    { prompt_tokens: 1000, completion_tokens: 80, prompt_cache_hit_tokens: 700 },
  ]) {
    assert.deepEqual(normalizeUsage(usage), { inputTokens: 1000, outputTokens: 80, cachedInputTokens: 700 });
  }
  assert.deepEqual(usageMeta([normalizeUsage({ prompt_tokens: 1000, prompt_cache_hit_tokens: 0 })]).cache, { hit: false, inputTokenHitRate: 0 });
});

test('缺失或异常统计保持未知，不将缓存写入数当作命中数', () => {
  for (const usage of [undefined, null, {}, { input_tokens: -1, output_tokens: '80', input_tokens_details: { cached_tokens: 1.5 } }, { input_tokens: Infinity, output_tokens: NaN }]) {
    assert.deepEqual(normalizeUsage(usage), unknown);
  }
  assert.equal(normalizeUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 101 } }).cachedInputTokens, null);
  assert.equal(normalizeUsage({ input_tokens_details: { cache_write_tokens: 700 } }).cachedInputTokens, null);
  assert.deepEqual(usageMeta([]), { usage: unknown, cache: { hit: null, inputTokenHitRate: null } });
  assert.deepEqual(usageMeta([normalizeUsage({ prompt_tokens: 1000, completion_tokens: 80 })]).cache, { hit: null, inputTokenHitRate: null });
});

test('重试按token数累计并加权，任一轮未知的字段不返回不完整总量', () => {
  const first = normalizeUsage({ prompt_tokens: 1000, completion_tokens: 80, prompt_cache_hit_tokens: 700 });
  const second = normalizeUsage({ input_tokens: 2000, output_tokens: 120, input_tokens_details: { cached_tokens: 1400 } });
  assert.deepEqual(usageMeta([first, second]), { usage: { inputTokens: 3000, outputTokens: 200, cachedInputTokens: 2100 }, cache: { hit: true, inputTokenHitRate: 0.7 } });
  assert.deepEqual(usageMeta([first, normalizeUsage({ input_tokens: 2000, output_tokens: 120 })]), { usage: { inputTokens: 3000, outputTokens: 200, cachedInputTokens: null }, cache: { hit: null, inputTokenHitRate: null } });
  assert.deepEqual(usageMeta([first, unknown]), { usage: unknown, cache: { hit: null, inputTokenHitRate: null } });
});

test('没有输入总数或输入为0时不计算比例，超出安全整数的总量保持未知', () => {
  assert.deepEqual(usageMeta([normalizeUsage({ prompt_cache_hit_tokens: 10 })]).cache, { hit: true, inputTokenHitRate: null });
  assert.deepEqual(usageMeta([normalizeUsage({ input_tokens: 0, input_tokens_details: { cached_tokens: 0 } })]).cache, { hit: false, inputTokenHitRate: null });
  assert.equal(usageMeta([normalizeUsage({ input_tokens: Number.MAX_SAFE_INTEGER }), normalizeUsage({ input_tokens: 1 })]).usage.inputTokens, null);
});
