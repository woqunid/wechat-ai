import assert from 'node:assert/strict';
import { test } from 'node:test';
import { aiRequestOptions, loadAIPreferences, saveAIPreferences, selectedAIIsReady } from '../src/ai-preferences.js';

let stored;
globalThis.localStorage = {
  getItem: key => key === 'weave-ai-preferences' ? stored ?? null : null,
  setItem: (key, value) => { if (key === 'weave-ai-preferences') stored = value; },
};

test('个人 AI 偏好保存在浏览器，并仅在个人模式生成请求配置', () => {
  stored = undefined;
  const personalConfig = { baseUrl: 'https://api.example.com/v1', apiKey: 'user-key', model: 'model-a', models: ['model-a'] };
  const preferences = { provider: 'personal', personalConfig };
  saveAIPreferences(preferences);
  assert.deepEqual(loadAIPreferences(), preferences);
  assert.deepEqual(aiRequestOptions(preferences), { aiProvider: 'personal', aiConfig: { baseUrl: personalConfig.baseUrl, apiKey: personalConfig.apiKey, model: personalConfig.model } });
  assert.equal(selectedAIIsReady(preferences, { aiConfigured: false }), true);
  assert.deepEqual(aiRequestOptions({ provider: 'platform', personalConfig }), { aiProvider: 'platform' });
});

test('忽略格式错误或不完整的本机个人配置', () => {
  stored = JSON.stringify({ provider: 'personal', personalConfig: { baseUrl: 'https://api.example.com', apiKey: 42, model: 'model-a' } });
  assert.deepEqual(loadAIPreferences(), { provider: 'platform', personalConfig: null });
});
