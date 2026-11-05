import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { cleanupExpiredAssets, findImageFiles, imageDateDirectory, imageLifetime } from '../server/image-storage.js';
import { articleWithHtml } from '../src/html-document.js';

const day = 86_400_000;
const temporaryDirectory = async t => {
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'wechat-image-test-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'wechat-image-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
};

test('图片目录按北京时间跨日，保留期最少 30 天', () => {
  assert.equal(imageDateDirectory(Date.parse('2026-11-05T15:59:59Z')), '2026-11-05');
  assert.equal(imageDateDirectory(Date.parse('2026-11-05T16:00:00Z')), '2026-11-06');
  assert.equal(imageDateDirectory(Date.parse('2026-12-31T16:00:00Z')), '2027-01-01');
  for (const value of ['', '7', '30', '-1', 'invalid', Infinity]) assert.equal(imageLifetime(value), 30 * day);
  assert.equal(imageLifetime('45'), 45 * day);
});

test('兼容旧目录，按每张图片的时间清理，未满 30 天和其他文件保留', async t => {
  const directory = await temporaryDirectory(t);
  const now = Date.parse('2026-11-06T12:00:00Z');
  const write = async (filename, age) => {
    const target = path.join(directory, filename);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'fixture');
    await fs.utimes(target, new Date(now - age), new Date(now - age));
  };
  await write('img_legacy.png', 10 * day);
  await write('img_expired.jpg', 31 * day);
  await write('2026-10-07/img_shared.png', 30 * day - 1000);
  await write('2026-10-07/img_boundary.webp', 30 * day);
  await write('2026-09-01/img_recent.png', day);
  await write('2026-11-06/img_expired.png', 31 * day);
  await write('2026-10-07/notes.txt', 31 * day);
  await write('other/img_other.png', 31 * day);
  await fs.mkdir(path.join(directory, '2026-10-01'));
  assert.deepEqual(findImageFiles(directory, 'img_legacy'), ['img_legacy.png']);
  assert.deepEqual(findImageFiles(directory, 'img_shared'), ['2026-10-07/img_shared.png']);
  assert.deepEqual(findImageFiles(directory, '../img_legacy'), []);
  cleanupExpiredAssets(directory, now);
  assert.deepEqual(findImageFiles(directory, 'img_expired'), []);
  assert.deepEqual(findImageFiles(directory, 'img_boundary'), []);
  assert.equal(findImageFiles(directory, 'img_legacy').length, 1);
  assert.equal(findImageFiles(directory, 'img_shared').length, 1);
  assert.equal(findImageFiles(directory, 'img_recent').length, 1);
  await fs.access(path.join(directory, '2026-10-07/notes.txt'));
  await fs.access(path.join(directory, 'other/img_other.png'));
  await assert.rejects(fs.access(path.join(directory, '2026-11-06')), { code: 'ENOENT' });
  await assert.rejects(fs.access(path.join(directory, '2026-10-01')), { code: 'ENOENT' });
  cleanupExpiredAssets(directory, now + 1000);
  assert.deepEqual(findImageFiles(directory, 'img_shared'), []);
  await fs.access(path.join(directory, '2026-10-07/notes.txt'));
});

test('上传、静态访问、生成校验、AI 读取和删除兼容新旧图片路径', { timeout: 20_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await temporaryDirectory(t);
  const assets = path.join(directory, 'assets');
  await fs.mkdir(assets);
  const image = await sharp({ create: { width: 4, height: 3, channels: 3, background: '#FFFFFF' } }).png().toBuffer();
  await fs.writeFile(path.join(assets, 'img_legacy.png'), image);
  await fs.utimes(path.join(assets, 'img_legacy.png'), new Date(Date.now() - 10 * day), new Date(Date.now() - 10 * day));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const bootstrap = path.join(directory, 'bootstrap.mjs');
  await fs.writeFile(bootstrap, `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    const read = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (String(file).replaceAll('\\\\', '/').endsWith('/.local/ai-config.json')) return JSON.stringify({baseUrl:'http://image-test.invalid/v1',apiKey:'test-only',model:'fixture'});
      return read.call(this, file, ...args);
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('http://image-test.invalid/')) return originalFetch(url, options);
      const content = JSON.parse(options.body).input[1].content;
      const input = JSON.parse(content[0].text);
      if (input.article) {
        assert.equal(input.imageDimensions.length, 2);
        assert.ok(input.imageDimensions.every(image => image.width === 4 && image.height === 3));
        const images = content.filter(item => item.type === 'input_image');
        assert.equal(images.length, 2);
        assert.ok(images.every(item => item.image_url === ${JSON.stringify('data:image/png;base64,' + image.toString('base64'))}));
        return Response.json({output_text:JSON.stringify({message:'图片读取成功',operations:[]})});
      }
      return Response.json({output_text:JSON.stringify({title:'图片测试',summary:'',blocks:[{type:'paragraph',runs:[{text:'检查新旧图片是否可以继续使用。'}]},...input.imageAssetIds.map(assetId => ({type:'image',assetId}))]})});
    };
    await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/index.js')).href)});
  `);
  const child = spawn(process.execPath, [bootstrap], { cwd: root, env: { ...process.env, PORT: String(port), ASSET_DIR: assets, ASSET_TTL_DAYS: '7', PUBLIC_BASE_URL: 'https://images.example.com', AI_BASE_URL: 'http://image-test.invalid/v1', AI_API_KEY: 'test-only', AI_MODEL: 'fixture', AI_API_STYLE: 'responses', AI_TIMEOUT_MS: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test API did not start: ' + errors)), 8000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('server listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Test API exited: ' + code + ' ' + errors)); });
  });
  const base = 'http://127.0.0.1:' + port;
  const upload = async route => {
    const body = new FormData(); body.append('file', new Blob([image], { type: 'image/png' }), 'image.png');
    const response = await fetch(base + route, { method: 'POST', body });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  assert.equal((await fetch(base + '/uploads/img_legacy.png')).status, 200);
  const before = Date.now();
  const { asset } = await upload('/api/assets');
  assert.match(asset.cacheUrl, /^\/uploads\/\d{4}-\d{2}-\d{2}\/img_[\w-]+\.png$/);
  assert.ok([imageDateDirectory(before), imageDateDirectory()].includes(asset.cacheUrl.split('/')[2]));
  assert.equal(asset.url, 'https://images.example.com' + asset.cacheUrl);
  assert.ok(Date.parse(asset.expiresAt) >= before + 30 * day);
  assert.ok(Date.parse(asset.expiresAt) <= Date.now() + 30 * day);
  await fs.access(path.join(assets, asset.cacheUrl.slice('/uploads/'.length)));
  assert.equal((await fetch(base + asset.cacheUrl)).status, 200);
  const { attachment } = await upload('/api/articles/edit/attachments');
  assert.match(attachment.cacheUrl, /^\/uploads\/\d{4}-\d{2}-\d{2}\//);
  const post = async (route, body) => {
    const response = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await response.json();
    assert.equal(response.status, 200, JSON.stringify(data));
    return data;
  };
  await post('/api/articles/generate', { topic: '检查新旧图片素材', assetIds: [asset.id, 'img_legacy'] });
  const now = new Date().toISOString();
  const article = articleWithHtml({ schemaVersion: 1, id: 'image-api', mode: 'create', title: '', summary: '', blocks: [], templateId: 'T01', settings: {}, createdAt: now, updatedAt: now }, '<section><p>图片读取测试</p><img data-asset-id="' + asset.id + '"><img data-asset-id="img_legacy"></section>');
  const edited = await post('/api/articles/edit', { article, prompt: '检查图片', attachments: [{ kind: 'image', name: '新图片', assetId: attachment.assetId }, { kind: 'image', name: '旧图片', assetId: 'img_legacy' }] });
  assert.equal(edited.message, '图片读取成功');
  for (const [id, cacheUrl] of [[asset.id, asset.cacheUrl], [attachment.assetId, attachment.cacheUrl], ['img_legacy', '/uploads/img_legacy.png']]) {
    assert.equal((await fetch(base + '/api/assets/' + id, { method: 'DELETE' })).status, 204);
    assert.equal((await fetch(base + cacheUrl)).ok, false);
    await assert.rejects(fs.access(path.join(assets, cacheUrl.slice('/uploads/'.length))), { code: 'ENOENT' });
    assert.deepEqual(findImageFiles(assets, id), []);
  }
});
