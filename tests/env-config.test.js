import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { test } from 'node:test';
import dotenv from 'dotenv';
import { writePlatformAIConfig } from '../server/env-config.js';

async function withTempDirectory(callback) {
  const directory = await mkdtemp(path.join(tmpdir(), 'wechat-env-test-'));
  try { await callback(directory); }
  finally {
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'wechat-env-test-'));
    await rm(directory, { recursive: true, force: true });
  }
}

test('保存平台配置时保留其他环境设置并安全引用密钥', async () => {
  await withTempDirectory(async directory => {
    const filePath = path.join(directory, '.env');
    await writeFile(filePath, '# keep this comment\nPORT=8787\nAI_BASE_URL=old\nAI_API_KEY=old\nAI_MODEL=old\n', 'utf8');
    const values = {
      AI_BASE_URL: 'https://api.example.com/v1',
      AI_API_KEY: 'key-with-"quote"-\\-#-equals=',
      AI_MODEL: 'model-"preview"',
    };
    await writePlatformAIConfig(filePath, values);
    const content = await readFile(filePath, 'utf8');
    const parsed = dotenv.parse(content);
    assert.match(content, /# keep this comment/);
    assert.equal(parsed.PORT, '8787');
    assert.equal(parsed.AI_BASE_URL, values.AI_BASE_URL);
    assert.equal(parsed.AI_API_KEY, values.AI_API_KEY);
    assert.equal(parsed.AI_MODEL, values.AI_MODEL);
    assert.equal((content.match(/^AI_API_KEY=/gm) || []).length, 1);
  });
});

test('缺少 .env 时自动创建，拒绝换行注入', async () => {
  await withTempDirectory(async directory => {
    const nestedDirectory = path.join(directory, 'config');
    await mkdir(nestedDirectory);
    const filePath = path.join(nestedDirectory, '.env');
    await writePlatformAIConfig(filePath, { AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '' });
    const parsed = dotenv.parse(await readFile(filePath, 'utf8'));
    assert.equal(parsed.AI_BASE_URL, '');
    assert.equal(parsed.AI_API_KEY, '');
    assert.equal(parsed.AI_MODEL, '');
    await assert.rejects(writePlatformAIConfig(filePath, { AI_BASE_URL: 'https://example.com\nPORT=1', AI_API_KEY: '', AI_MODEL: '' }));
    assert.equal(dotenv.parse(await readFile(filePath, 'utf8')).PORT, undefined);
  });
});
