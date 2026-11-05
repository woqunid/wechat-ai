import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { articleWithHtml } from '../src/html-document.js';
import { buildAIEdit, createAIReference } from '../src/ai-edit.js';

test('HTML 修改接口：全文、局部选区、越界拦截与原文保护', { timeout: 20_000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), 'wechat-html-test-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const bootstrap = path.join(directory, 'bootstrap.mjs');
  await writeFile(bootstrap, `
    import fs from 'node:fs';
    const originalRead = fs.readFileSync;
    fs.readFileSync = function(file, ...args) {
      if (String(file).replaceAll('\\\\', '/').endsWith('/.local/ai-config.json')) return JSON.stringify({baseUrl:'http://html-test.invalid/v1',apiKey:'test-only',model:'fixture'});
      return originalRead.call(this, file, ...args);
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('http://html-test.invalid/')) return originalFetch(url, options);
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.input[1].content[0].text);
      if (!input.article.html || !body.input[0].content[0].text.includes('article.html')) throw new Error('Missing HTML model context');
      const operation = input.prompt === 'selection'
        ? {type:'replaceHtml', referenceId:input.references[0].id, html:'<strong style="color:#26332F;">选中文字</strong>'}
        : {type:'setHtml',html:input.prompt === 'content-guard' ? input.article.html.replace('选中文字','擅自改写') : input.article.html.replace('padding:16px;', 'padding:8px;')};
      return Response.json({output_text:JSON.stringify({message:'待确认方案',operations:[operation]})});
    };
    await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/index.js')).href)});
  `);
  const child = spawn(process.execPath, [bootstrap], { cwd: root, env: { ...process.env, PORT: String(port), AI_API_STYLE: 'responses', AI_TIMEOUT_MS: '2000', ASSET_DIR: path.join(directory, 'assets') }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test API did not start')), 8000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('server listening')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited: ${code}`)); });
    });
    const now = new Date().toISOString();
    const article = articleWithHtml({ schemaVersion: 1, id: 'api-test', mode: 'create', title: '', summary: '', blocks: [], templateId: 'T01', settings: {}, createdAt: now, updatedAt: now }, '<section data-node-id="page" style="color:#26332F;background-color:#FFFFFF;padding:16px;"><p data-node-id="target">保留选中文字结尾</p><p>其他段落</p></section>');
    const reference = createAIReference(article, { kind: 'text', keys: ['html:target'], text: '选中文字', startOffset: 2, endOffset: 6 });
    const request = async (prompt, scope = 'article') => {
      const response = await fetch(`http://127.0.0.1:${port}/api/articles/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ article, prompt, scope, references: [reference] }) });
      return { status: response.status, data: await response.json() };
    };
    const full = await request('layout');
    assert.equal(full.status, 200);
    assert.match(buildAIEdit(article, full.data.operations).html, /padding:8px/);
    const selection = await request('selection', 'selection');
    assert.equal(selection.status, 200);
    assert.match(buildAIEdit(article, selection.data.operations, { scope: 'selection', references: [reference] }).html, /<strong/);
    assert.equal((await request('scope-denied', 'selection')).data.error.code, 'AI_EDIT_FAILED');
    assert.equal((await request('content-guard')).data.error.code, 'AI_EDIT_FAILED');
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep + 'wechat-html-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
