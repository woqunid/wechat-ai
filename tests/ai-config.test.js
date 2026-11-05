import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getAIStatus, resolveRequestAIConfig } from '../server/ai-config.js';

test('个人 AI 请求使用本次请求的密钥，不回退到平台密钥', async () => {
  const previous = Object.fromEntries(['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'].map(key => [key, process.env[key]]));
  process.env.AI_BASE_URL = 'https://platform.example.com/v1';
  process.env.AI_API_KEY = 'platform-secret';
  process.env.AI_MODEL = 'platform-model';
  try {
    await assert.rejects(
      resolveRequestAIConfig({ aiProvider: 'personal', aiConfig: { baseUrl: 'https://personal.example.com/v1', model: 'personal-model' } }),
      error => error.code === 'INVALID_AI_KEY',
    );
    const config = await resolveRequestAIConfig({ aiProvider: 'personal', aiConfig: { baseUrl: 'https://personal.example.com/v1', apiKey: 'personal-secret', model: 'personal-model' } });
    assert.equal(config.apiKey, 'personal-secret');
    assert.equal(config.model, 'personal-model');
    assert.equal(getAIStatus().model, 'platform-model');
    assert.equal(Object.hasOwn(getAIStatus(), 'apiKey'), false);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
