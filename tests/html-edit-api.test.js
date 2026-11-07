import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import sharp from 'sharp';
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
    const attempts = new Map();
    globalThis.fetch = async (url, options) => {
      if (!String(url).startsWith('http://html-test.invalid/')) return originalFetch(url, options);
      const body = JSON.parse(options.body);
      const input = JSON.parse(body.input ? body.input[1].content[0].text : body.messages[1].content);
      const prompt = input.prompt || input.designPrompt || input.topic || '';
      const failure = /^upstream-(401|429|500|503)/.exec(prompt);
      if (failure) {
        const count = (attempts.get(prompt) || 0) + 1;
        attempts.set(prompt, count);
        return Response.json({error:{code:prompt.includes('price') ? 'model_price_error' : 'fixture_error'}}, {status:count === 1 ? Number(failure[1]) : 599});
      }
      if (prompt.startsWith('timeout-')) throw Object.assign(new Error('fixture timeout'), {name:'TimeoutError'});
      if (prompt === 'chat-fallback') {
        if (body.input) {
          const count = (attempts.get(prompt) || 0) + 1;
          attempts.set(prompt, count);
          return Response.json({error:{message:'unsupported endpoint'}}, {status:count === 1 ? 404 : 401});
        }
        return Response.json({choices:[{message:{content:JSON.stringify({message:'兼容接口可用',operations:[]})}}]});
      }
      if (!input.article.html || !body.input[0].content[0].text.includes('article.html')) throw new Error('Missing HTML model context');
      if ('scope' in input) throw new Error('Manual scope must not be sent');
      if ('layoutDesign' in input.article || input.article.blocks.some(block => block.runs || block.text.length > 40)) throw new Error('HTML article must send block outline only');
      if (input.prompt === 'insert-attachment') {
        const image = input.insertableImages?.[0];
        const content = body.input[1].content;
        if (!image?.width || !content.some(item => item.type === 'input_text' && item.text.includes(image.assetId)) || !content.some(item => item.type === 'input_image')) throw new Error('Missing insertable image');
        return Response.json({output_text:JSON.stringify({message:'已插入附件图片',operations:[{type:'setHtml',intent:'content',html:input.article.html + '<img data-asset-id="' + image.assetId + '" alt="附件图">'}]})});
      }
      if (input.prompt === 'ambiguous') return Response.json({output_text:JSON.stringify({message:'需要调整哪一段？',operations:[]})});
      if (input.prompt === 'garbage') return Response.json({output_text:'not json'});
      if (input.prompt === 'unsupported-styles' && !input.previousValidationError) return Response.json({output_text:JSON.stringify({message:'调整样式',operations:[{type:'setHtml',html:input.article.html.replace('padding:16px;', 'padding:8px;display:grid;')}]})});
      if (input.prompt === 'unsupported-styles' && input.previousValidationError) return Response.json({output_text:JSON.stringify({message:'改用合规样式',operations:[{type:'setHtml',html:input.article.html.replace('padding:16px;', 'padding:8px;')}]})});
      if (input.prompt === 'unsupported-fallback' && input.previousValidationError) return Response.json({output_text:'not json'});
      if (input.prompt === 'unsupported-fallback') return Response.json({output_text:JSON.stringify({message:'调整样式',operations:[{type:'setHtml',html:input.article.html.replace('padding:16px;', 'padding:8px;display:grid;')}]})});
      if (input.prompt === 'slow') await new Promise(resolve => setTimeout(resolve, 300));
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
  const child = spawn(process.execPath, [bootstrap], { cwd: root, env: { ...process.env, PORT: String(port), AI_BASE_URL: 'http://html-test.invalid/v1', AI_API_KEY: 'test-only', AI_MODEL: 'fixture', AI_API_STYLE: 'auto', AI_TIMEOUT_MS: '2000', RATE_EDIT_PER_MIN: '100', ASSET_DIR: path.join(directory, 'assets') }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Test API did not start')), 8000);
      child.stdout.on('data', chunk => { if (String(chunk).includes('server listening')) { clearTimeout(timer); resolve(); } });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited: ${code}`)); });
    });
    const now = new Date().toISOString();
    const article = articleWithHtml({ schemaVersion: 1, id: 'api-test', mode: 'create', title: '', summary: '', blocks: [], templateId: 'T01', settings: {}, createdAt: now, updatedAt: now }, '<section data-node-id="page" style="color:#26332F;background-color:#FFFFFF;padding:16px;"><p data-node-id="target">保留选中文字结尾</p><p>其他段落</p></section>');
    const reference = createAIReference(article, { kind: 'text', keys: ['html:target'], text: '选中文字', startOffset: 2, endOffset: 6 });
    const request = async (prompt, { headers, ...options } = {}) => {
      const response = await fetch(`http://127.0.0.1:${port}/api/articles/edit`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ article, prompt, references: [reference], ...options }) });
      return { status: response.status, data: await response.json() };
    };
    const full = await request('layout');
    assert.equal(full.status, 200);
    assert.match(buildAIEdit(article, full.data.operations).html, /padding:8px/);
    const repairedStyles = await request('unsupported-styles', { references: [] });
    assert.equal(repairedStyles.status, 200);
    assert.equal(repairedStyles.data.meta.retried, true);
    assert.match(buildAIEdit(article, repairedStyles.data.operations).html, /padding:8px/);
    assert.doesNotMatch(buildAIEdit(article, repairedStyles.data.operations).html, /display:grid/);
    const ignoredStyles = await request('unsupported-fallback', { references: [] });
    assert.equal(ignoredStyles.status, 200);
    assert.match(ignoredStyles.data.message, /已忽略公众号不支持的样式.*display:grid/);
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
    const invalidTarget = (await request('invalid-target', { references: [] })).data.error;
    assert.equal(invalidTarget.code, 'AI_EDIT_FAILED');
    assert.match(invalidTarget.message, /修改目标不存在/);
    const guarded = (await request('content-guard')).data.error;
    assert.equal(guarded.code, 'AI_EDIT_FAILED');
    assert.match(guarded.message, /排版修改必须保留原文/);
    assert.equal((await request('garbage', { references: [] })).data.error.message, '修改方案未通过内容或版式检查，原稿已保留，请重试');
    const concurrent = await Promise.all(Array.from({ length: 3 }, () => request('slow')));
    assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 200, 429]);
    assert.match(concurrent.find(result => result.status === 429).data.error.message, /已有生成任务进行中/);
    const differentSources = await Promise.all(Array.from({ length: 3 }, (_, i) => request('slow', { headers: { 'X-Forwarded-For': `192.0.2.${i + 1}` } })));
    assert.deepEqual(differentSources.map(result => result.status), [200, 200, 200]);
    const form = new FormData();
    form.append('file', new Blob([await sharp({ create: { width: 4, height: 3, channels: 3, background: '#99bda1' } }).png().toBuffer()], { type: 'image/png' }), 'photo.png');
    const { attachment } = await (await fetch(`http://127.0.0.1:${port}/api/articles/edit/attachments`, { method: 'POST', body: form })).json();
    assert.deepEqual([attachment.width, attachment.height], [4, 3]);
    const inserted = await request('insert-attachment', { references: [], attachments: [{ kind: 'image', name: attachment.name, assetId: attachment.assetId }] });
    assert.equal(inserted.status, 200);
    assert.match(buildAIEdit(article, inserted.data.operations, { assetIds: [attachment.assetId] }).html, new RegExp(attachment.assetId));
    assert.equal((await request('insert-attachment', { references: [] })).data.error.code, 'AI_EDIT_FAILED');
    const ambiguous = await request('ambiguous', { references: [] });
    assert.equal(ambiguous.status, 200);
    assert.deepEqual(ambiguous.data.operations, []);
    for (const route of ['generate', 'design', 'edit']) {
      for (const scenario of ['401', '429', '503', '500-price', 'timeout']) {
        const prompt = scenario === 'timeout' ? `timeout-${route}` : `upstream-${scenario}-${route}`;
        const body = route === 'generate' ? { topic: prompt } : route === 'design' ? { article, mode: 'prompt', prompt } : { article, prompt };
        const response = await fetch(`http://127.0.0.1:${port}/api/articles/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const { error } = await response.json();
        assert.equal(response.status, scenario === 'timeout' ? 504 : 502);
        assert.equal(error.code, scenario === 'timeout' ? 'AI_TIMEOUT' : scenario.includes('price') ? 'AI_UPSTREAM_CONFIG_ERROR' : 'AI_UPSTREAM_ERROR');
        if (/^\d+$/.test(scenario)) assert.match(error.message, new RegExp(`HTTP ${scenario}`));
      }
    }
    const aiConfig = { baseUrl: 'http://html-test.invalid/v1', apiKey: 'test-only', model: 'chat-only' };
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await request('chat-fallback', { aiProvider: 'personal', aiConfig });
      assert.equal(result.status, 200);
      assert.equal(result.data.message, '兼容接口可用');
    }
  } finally {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit'); }
    const resolved = path.resolve(directory);
    assert.ok(resolved.startsWith(path.resolve(tmpdir()) + path.sep + 'wechat-html-test-'));
    await rm(resolved, { recursive: true, force: true });
  }
});
