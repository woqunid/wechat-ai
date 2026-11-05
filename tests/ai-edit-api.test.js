import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import sharp from 'sharp';

const root = path.resolve(import.meta.dirname, '..');
const parent = path.join(root, '.local');
let sandbox, processUnderTest, upstream, origin, payload, result, attempts, waiting, upstreamClosed;
let modelUsage, requests, supportsResponses = false;
const article = () => ({ schemaVersion: 1, id: 'article_api', mode: 'raw', title: '文章标题', summary: '原有摘要', templateId: 'T17', settings: {}, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', blocks: [{ id: 'a', type: 'paragraph', runs: [{ text: '2026年11月5日，第一段原文。' }] }, { id: 'b', type: 'paragraph', runs: [{ text: '即使引用第一段，也需要读取这一段全文。' }] }] });
const edit = async (body, status = 200, options = {}) => {
  const response = await fetch(`${origin}/api/articles/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, ...options.headers }, body: JSON.stringify(body), signal: options.signal });
  assert.equal(response.status, status);
  return response.json();
};
const timeout = promise => Promise.race([promise, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('API test timed out')), 8000); timer.unref(); })]);

before(async () => {
  fs.mkdirSync(parent, { recursive: true });
  sandbox = fs.mkdtempSync(path.join(parent, 'ai-edit-api-test-'));
  for (const name of ['src', 'server']) fs.cpSync(path.join(root, name), path.join(sandbox, name), { recursive: true });
  upstream = http.createServer(async (request, response) => {
    if (request.url === '/v1/models') {
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ data: [{ id: 'mock-model' }, { id: 'responses-model' }] }));
      return;
    }
    let body = '';
    for await (const chunk of request) body += chunk;
    const data = JSON.parse(body);
    requests.push({ url: request.url, body: data });
    if (request.url === '/v1/responses' && !supportsResponses) {
      response.writeHead(404).end('not found');
      return;
    }
    payload = JSON.parse(data.messages?.at(-1).content ?? data.input.at(-1).content[0].text);
    attempts++;
    if (waiting) {
      response.once('close', () => upstreamClosed?.());
      waiting();
      return;
    }
    response.setHeader('Content-Type', 'application/json');
    const text = JSON.stringify(typeof result === 'function' ? result(attempts) : result);
    const usage = typeof modelUsage === 'function' ? modelUsage(attempts) : modelUsage;
    response.end(JSON.stringify(request.url === '/v1/responses' ? { output: [{ type: 'message', content: [{ type: 'output_text', text }] }], usage } : { choices: [{ message: { content: text } }], usage }));
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const probe = net.createServer();
  probe.listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  processUnderTest = spawn(process.execPath, ['server/index.js'], { cwd: sandbox, windowsHide: true, env: { ...process.env, PORT: String(port), ASSET_DIR: path.join(sandbox, 'uploads'), AI_BASE_URL: `http://127.0.0.1:${upstream.address().port}/v1`, AI_API_KEY: 'test-only-no-secret', AI_MODEL: 'mock-model', AI_API_STYLE: 'auto', RATE_EDIT_PER_MIN: '1000', DOTENV_CONFIG_QUIET: 'true' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await timeout(new Promise((resolve, reject) => {
    processUnderTest.once('error', reject);
    processUnderTest.once('exit', code => reject(new Error(`Isolated API exited: ${code}`)));
    processUnderTest.stdout.on('data', chunk => { if (String(chunk).includes('wechat-ai server listening')) resolve(); });
  }));
});

beforeEach(() => { modelUsage = undefined; requests = []; });

after(async () => {
  if (processUnderTest?.exitCode === null) {
    const exited = once(processUnderTest, 'exit');
    processUnderTest.kill();
    await timeout(exited);
  }
  if (upstream) { upstream.closeAllConnections(); await new Promise(resolve => upstream.close(resolve)); }
  if (sandbox) {
    const resolved = path.resolve(sandbox);
    assert.ok(resolved.startsWith(path.resolve(parent) + path.sep) && path.basename(resolved).startsWith('ai-edit-api-test-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});

test('对话接口读取全文与历史，引用仅作关注点，raw允许修改引用外段落', async () => {
  attempts = 0;
  const base = article();
  result = { message: '调整第二段表达，待你确认。', operations: [{ type: 'updateBlock', block: { ...base.blocks[1], runs: [{ text: '第二段修改后的表达。' }] } }] };
  const data = await edit({ article: base, prompt: '调整第二段表达', references: [{ id: 'ref_test', kind: 'text', keys: ['block:a'], text: '第一段原文' }], messages: [{ role: 'user', text: '保留事实。' }] });
  assert.equal(attempts, 1);
  assert.deepEqual(requests.map(request => request.url), ['/v1/responses', '/v1/chat/completions']);
  assert.equal(payload.article.blocks.length, 2);
  assert.equal(payload.references[0].keys[0], 'block:a');
  assert.equal(payload.conversation[0].text, '保留事实。');
  assert.equal(data.operations[0].block.id, 'b');
  assert.ok(data.changes.some(change => change.key === 'block:b'));
  assert.equal(data.article, undefined);
  assert.equal(data.meta.model, 'mock-model');
  assert.equal(base.blocks[1].runs[0].text, '即使引用第一段，也需要读取这一段全文。');
});

test('图片只发送尺寸，支持宽度和位置调整，素材解析与40套模板继续工作', async () => {
  attempts = 0;
  const image = await sharp({ create: { width: 120, height: 80, channels: 3, background: '#ffffff' } }).png().toBuffer();
  const form = new FormData();
  form.append('file', new Blob([image], { type: 'image/png' }), 'test.png');
  const upload = await fetch(`${origin}/api/assets`, { method: 'POST', body: form });
  assert.equal(upload.status, 200);
  const { asset } = await upload.json();
  const base = article();
  base.blocks.push({ id: 'photo', type: 'imageCard', assetId: asset.id, caption: '原有图注' });
  result = { message: '图片缩至60%并放在开头。', operations: [{ type: 'updateBlock', block: { ...base.blocks[2], style: { imageWidth: 60, align: 'center' } } }, { type: 'moveBlock', id: 'photo', afterId: null }] };
  const data = await edit({ article: base, prompt: '调整图片布局' });
  assert.deepEqual(payload.imageDimensions, [{ assetId: asset.id, width: 120, height: 80 }]);
  assert.equal(JSON.stringify(payload).includes('image_url'), false);
  assert.ok(data.changes.some(change => change.after.includes('图片宽度：60%')));
  assert.ok(data.changes.some(change => change.key === 'block:photo' && change.label.includes('位置')));
  const templates = await (await fetch(`${origin}/api/templates`)).json();
  assert.equal(templates.templates.length, 40);
  const materials = new FormData();
  materials.append('files', new Blob(['这是一个用于验证素材解析功能没有受到影响的文本文件，保留原始文字和标点。']), 'test.txt');
  const parsed = await (await fetch(`${origin}/api/materials/parse`, { method: 'POST', body: materials })).json();
  assert.equal(parsed.files[0].ok, true);
});

test('模型输出无效时只纠正一次，合法草稿作为候选返回', async () => {
  attempts = 0;
  modelUsage = count => ({ prompt_tokens: count * 1000, completion_tokens: count * 100, prompt_cache_hit_tokens: count * 700 });
  result = count => count === 1 ? { message: '删除不存在段落', operations: [{ type: 'removeBlock', id: 'missing' }] } : { message: '已提出摘要修改方案。', operations: [{ type: 'setSummary', text: '新的摘要' }] };
  const data = await edit({ article: article(), prompt: '修改摘要' });
  assert.equal(attempts, 2);
  assert.equal(data.meta.retried, true);
  assert.deepEqual(data.meta.usage, { inputTokens: 3000, outputTokens: 300, cachedInputTokens: 2100 });
  assert.deepEqual(data.meta.cache, { hit: true, inputTokenHitRate: 0.7 });
  assert.ok(payload.previousValidationError.includes('不存在'));
  assert.equal(data.changes[0].key, 'summary');
});

test('连续无效输出返回失败，不返回可应用的方案', async () => {
  attempts = 0;
  result = { message: '新增未知图片', operations: [{ type: 'insertBlock', afterId: null, block: { id: 'forged', type: 'imageCard', assetId: 'img_fake', caption: '' } }] };
  const data = await edit({ article: article(), prompt: '修改文章' }, 502);
  assert.equal(attempts, 2);
  assert.equal(data.error.code, 'AI_EDIT_FAILED');
  assert.equal(data.operations, undefined);
});

test('无效输入和跨域请求不调用模型，旧rewrite接口保持移除', async () => {
  attempts = 0;
  assert.equal((await edit({ article: article(), prompt: ' ' }, 400)).error.code, 'INVALID_EDIT_INPUT');
  assert.equal((await edit({ article: article(), prompt: '修改' }, 403, { headers: { Origin: 'https://untrusted.example' } })).error.code, 'ORIGIN_NOT_ALLOWED');
  assert.equal(attempts, 0);
  const old = await fetch(`${origin}/api/articles/rewrite`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(old.status, 404);
});

test('咨询可以只回复文字，不产生候选改动', async () => {
  attempts = 0;
  result = { message: '你更希望调整表达，还是整体版式？', operations: [] };
  const data = await edit({ article: article(), prompt: '我想讨论一下修改方向' });
  assert.deepEqual(data.operations, []);
  assert.deepEqual(data.changes, []);
});

test('含空行的草稿可提交全文，空行保留且只修改目标段落', async () => {
  attempts = 0;
  const base = article();
  base.blocks.push({ id: 'blank', type: 'paragraph', runs: [{ text: '' }] });
  result = { message: '只修改标题，保留空行。', operations: [{ type: 'setTitle', text: '新的文章标题' }] };
  const data = await edit({ article: base, prompt: '改一下标题' });
  assert.equal(attempts, 1);
  assert.deepEqual(payload.article.blocks.at(-1), base.blocks.at(-1));
  assert.deepEqual(data.changes.map(change => change.key), ['title']);
});

test('普通文字样式不可读时纠正一次，仍不可读则拒绝返回候选', async () => {
  const base = article();
  const invisible = { ...base.blocks[1], runs: [{ text: '不可读文字', color: '#FFFFFF', highlight: '#FFFFFF' }] };
  attempts = 0;
  result = count => count === 1 ? { message: '修改颜色', operations: [{ type: 'updateBlock', block: invisible }] } : { message: '修正为清晰的文字颜色。', operations: [{ type: 'updateBlock', block: { ...invisible, runs: [{ text: '可读文字', color: '#FFFFFF', highlight: '#111111' }] } }] };
  assert.equal((await edit({ article: base, prompt: '调整文字颜色' })).meta.retried, true);
  assert.equal(attempts, 2);
  assert.ok(payload.previousValidationError.includes('对比度'));
  attempts = 0;
  result = { message: '修改颜色', operations: [{ type: 'updateBlock', block: invisible }] };
  assert.equal((await edit({ article: base, prompt: '调整文字颜色' }, 502)).error.code, 'AI_EDIT_FAILED');
  assert.equal(attempts, 2);
});

test('停止生成会中止模型请求并释放并发名额', async () => {
  attempts = 0;
  const entered = new Promise(resolve => { waiting = resolve; });
  const closed = new Promise(resolve => { upstreamClosed = resolve; });
  const controller = new AbortController();
  const pending = edit({ article: article(), prompt: '调整文章' }, 200, { signal: controller.signal });
  const rejection = assert.rejects(pending, cause => cause.name === 'AbortError');
  await timeout(entered);
  controller.abort();
  await rejection;
  await timeout(closed);
  waiting = null;
  upstreamClosed = null;
  result = { message: '停止后可以继续对话。', operations: [] };
  const data = await edit({ article: article(), prompt: '继续讨论' });
  assert.ok(data.message.includes('继续对话'));
});

test('更换本轮要求和引用时保留稳定全文与历史前缀，继续使用非流式请求', async () => {
  attempts = 0;
  result = { message: '可以继续讨论。', operations: [] };
  const base = article();
  const messages = [{ role: 'user', text: '保留事实' }, { role: 'assistant', text: '请说明修改方向' }];
  await edit({ article: base, prompt: '先讨论标题', messages });
  await edit({ article: base, prompt: '再讨论摘要', messages, references: [{ id: 'ref_second', kind: 'text', keys: ['block:b'], text: '第二段' }] });
  const inputs = requests.map(request => request.body.messages.at(-1).content);
  assert.equal(attempts, 2);
  assert.deepEqual(Object.keys(payload), ['template', 'article', 'imageDimensions', 'conversation', 'prompt', 'references']);
  assert.equal(inputs[0].split(',"prompt":')[0], inputs[1].split(',"prompt":')[0]);
  assert.deepEqual(payload.article.blocks, base.blocks);
  assert.deepEqual(payload.conversation, messages);
  assert.equal(payload.prompt, '再讨论摘要');
  assert.equal(payload.references[0].id, 'ref_second');
  assert.ok(requests.every(request => request.body.stream === undefined));
});

test('Chat接口返回真实缓存统计，区分命中、零命中和未提供统计', async () => {
  result = { message: '只讨论，不修改正文。', operations: [] };
  for (const [usage, cachedInputTokens, hit, inputTokenHitRate] of [
    [{ prompt_tokens: 1000, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 700 } }, 700, true, 0.7],
    [{ prompt_tokens: 1000, completion_tokens: 80, prompt_cache_hit_tokens: 700 }, 700, true, 0.7],
    [{ prompt_tokens: 1000, completion_tokens: 80, prompt_cache_hit_tokens: 0 }, 0, false, 0],
    [{ prompt_tokens: 1000, completion_tokens: 80 }, null, null, null],
  ]) {
    attempts = 0;
    modelUsage = usage;
    const data = await edit({ article: article(), prompt: '讨论修改方向' });
    assert.deepEqual(data.meta.usage, { inputTokens: 1000, outputTokens: 80, cachedInputTokens });
    assert.deepEqual(data.meta.cache, { hit, inputTokenHitRate });
    assert.equal(attempts, 1);
  }
  modelUsage = undefined;
  const data = await edit({ article: article(), prompt: '继续讨论' });
  assert.deepEqual(data.meta.usage, { inputTokens: null, outputTokens: null, cachedInputTokens: null });
  assert.deepEqual(data.meta.cache, { hit: null, inputTokenHitRate: null });
});

test('纠正重试某轮没有缓存统计时不将其余轮次冒充完整统计', async () => {
  attempts = 0;
  result = count => count === 1 ? { message: '无效修改', operations: [{ type: 'removeBlock', id: 'missing' }] } : { message: '继续讨论。', operations: [] };
  modelUsage = count => ({ prompt_tokens: 1000, completion_tokens: 80, ...(count === 1 ? { prompt_cache_hit_tokens: 700 } : {}) });
  const data = await edit({ article: article(), prompt: '调整摘要' });
  assert.equal(attempts, 2);
  assert.deepEqual(data.meta.usage, { inputTokens: 2000, outputTokens: 160, cachedInputTokens: null });
  assert.deepEqual(data.meta.cache, { hit: null, inputTokenHitRate: null });
});

test('生成和定制排版继续解析模型输出并返回缓存用量', async () => {
  attempts = 0;
  modelUsage = { prompt_tokens: 1000, completion_tokens: 80, prompt_cache_hit_tokens: 700 };
  result = { title: '测试生成', summary: '测试摘要', blocks: [{ type: 'paragraph', runs: [{ text: '内容'.repeat(300) }] }] };
  const generated = await fetch(`${origin}/api/articles/generate`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ mode: 'create', topic: '缓存接口兼容验证', targetLength: 600 }) });
  assert.equal(generated.status, 200);
  const generation = await generated.json();
  assert.equal(attempts, 1);
  assert.equal(generation.article.title, '测试生成');
  assert.deepEqual(generation.meta.usage, { inputTokens: 1000, outputTokens: 80, cachedInputTokens: 700 });
  assert.deepEqual(generation.meta.cache, { hit: true, inputTokenHitRate: 0.7 });
  result = { version: 1, name: '测试版式', description: '保持原文顺序', page: { backgroundColor: '#FFFFFF', color: '#26332F', fontFamily: 'sans', fontSize: 16, lineHeight: 1.9, paragraphGap: 18, paddingX: 16 }, rules: {}, nodes: ['title', 'summary', 'block:a', 'block:b'].map(ref => ({ type: 'content', ref })) };
  const designed = await fetch(`${origin}/api/articles/design`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ article: article(), mode: 'auto' }) });
  assert.equal(designed.status, 200);
  const design = await designed.json();
  assert.equal(design.design.name, '测试版式');
  assert.deepEqual(design.meta.usage, generation.meta.usage);
  assert.deepEqual(design.meta.cache, generation.meta.cache);
});

test('切换模型后自动使用Responses接口，累计其输出纠正及缓存用量', async () => {
  supportsResponses = true;
  const configured = await fetch(`${origin}/api/config/ai`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ baseUrl: `http://127.0.0.1:${upstream.address().port}/v1`, apiKey: 'test-only-no-secret', model: 'responses-model' }) });
  assert.equal(configured.status, 200);
  attempts = 0;
  modelUsage = count => ({ input_tokens: count * 1000, output_tokens: count * 100, input_tokens_details: { cached_tokens: count * 700 } });
  result = count => count === 1 ? { message: '无效修改', operations: [{ type: 'removeBlock', id: 'missing' }] } : { message: '已提出摘要方案', operations: [{ type: 'setSummary', text: '新摘要' }] };
  const data = await edit({ article: article(), prompt: '修改摘要' });
  assert.equal(attempts, 2);
  assert.ok(requests.every(request => request.url === '/v1/responses'));
  assert.ok(requests.every(request => request.body.stream === undefined));
  assert.equal(data.meta.model, 'responses-model');
  assert.equal(data.meta.retried, true);
  assert.deepEqual(data.meta.usage, { inputTokens: 3000, outputTokens: 300, cachedInputTokens: 2100 });
  assert.deepEqual(data.meta.cache, { hit: true, inputTokenHitRate: 0.7 });
});
