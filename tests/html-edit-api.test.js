import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { articleWithHtml, findHtmlNode } from '../src/html-document.js';
import { AIConversationMessageSchema, aiEditTargets, buildAIEdit, createAIReference } from '../src/ai-edit.js';

test('HTML 自动修改接口：选区、全文、主动定位、多轮延续与目标校验', { timeout: 20_000 }, async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await mkdtemp(path.join(tmpdir(), 'wechat-html-test-'));
  const socket = net.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(resolve));
  const bootstrap = path.join(directory, 'bootstrap.mjs');
  await writeFile(bootstrap, `
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('http://html-test.invalid/')) return originalFetch(url, options);
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.input[1].content[0].text);
      if (!input.article.html || !body.input[0].content[0].text.includes('article.html')) throw new Error('Missing HTML model context');
      if ('scope' in input) throw new Error('Manual scope must not be sent');
      if (input.prompt === 'ambiguous') return Response.json({output_text:JSON.stringify({message:'需要调整哪一段？',operations:[]})});
      const operation = input.prompt === 'selection'
        ? {type:'replaceHtml', referenceId:input.references[0].id, html:'<strong style="color:#26332F;">选中文字</strong>'}
        : input.prompt === 'locate'
        ? {type:'replaceHtml', nodeId:'target', html:'<p style="margin:0 0 4px;">保留选中文字结尾</p>'}
        : input.prompt === 'followup'
        ? {type:'replaceHtml', nodeId:input.conversation.at(-1).targets[0].slice(5), startOffset:input.conversation[0].references[0].startOffset, endOffset:input.conversation[0].references[0].endOffset, html:'<strong>选中文字</strong>'}
        : input.prompt === 'invalid-target'
        ? {type:'replaceHtml', nodeId:'nonexistent', html:'<p>错误区域</p>'}
        : {type:'setHtml',html:input.prompt === 'content-guard' ? input.article.html.replace('选中文字','擅自改写') : input.article.html.replace('padding:16px;', 'padding:8px;')};
      return Response.json({output_text:JSON.stringify({message:'待确认方案',operations:[operation]})});
    };
    await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/index.js')).href)});
  `);
  const child = spawn(process.execPath, [bootstrap], { cwd: root, env: { ...process.env, PORT: String(port), AI_BASE_URL: 'http://html-test.invalid/v1', AI_API_KEY: 'test-only', AI_MODEL: 'fixture', AI_API_STYLE: 'responses', AI_TIMEOUT_MS: '2000', ASSET_DIR: path.join(directory, 'assets') }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test API did not start')), 8000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('server listening')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited: ${code}`)); });
    });
    const now = new Date().toISOString();
    const article = articleWithHtml({ schemaVersion: 1, id: 'api-test', mode: 'create', title: '', summary: '', blocks: [], templateId: 'T01', settings: {}, createdAt: now, updatedAt: now }, '<section data-node-id="page" style="color:#26332F;background-color:#FFFFFF;padding:16px;"><p data-node-id="target">保留选中文字结尾</p><p>其他段落</p></section>');
    const reference = createAIReference(article, { kind: 'text', keys: ['html:target'], text: '选中文字', startOffset: 2, endOffset: 6 });
    const request = async (prompt, options = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/articles/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ article, prompt, references: [reference], ...options }) });
      return { status: response.status, data: await response.json() };
    };
    const full = await request('layout');
    assert.equal(full.status, 200);
    assert.match(buildAIEdit(article, full.data.operations).html, /padding:8px/);
    const selection = await request('selection');
    assert.equal(selection.status, 200);
    assert.match(buildAIEdit(article, selection.data.operations, { references: [reference] }).html, /<strong/);
    const local = await request('locate', { references: [] });
    assert.equal(local.status, 200);
    const current = buildAIEdit(article, local.data.operations);
    assert.match(findHtmlNode(current.html, 'target').attribs.style, /margin:0 0 4px/);
    const messages = [AIConversationMessageSchema.parse({ role: 'user', text: '选中文字加粗', references: [reference] }), { role: 'assistant', text: '调整对应段落', targets: aiEditTargets(local.data.operations), status: 'applied' }];
    const followup = await request('followup', { article: current, references: [], messages });
    assert.equal(followup.status, 200);
    assert.match(buildAIEdit(current, followup.data.operations).html, /<strong/);
    assert.equal((await request('invalid-target', { references: [] })).data.error.code, 'AI_EDIT_FAILED');
    assert.equal((await request('content-guard')).data.error.code, 'AI_EDIT_FAILED');
    const ambiguous = await request('ambiguous', { references: [] });
    assert.equal(ambiguous.status, 200);
    assert.deepEqual(ambiguous.data.operations, []);
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep + 'wechat-html-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
