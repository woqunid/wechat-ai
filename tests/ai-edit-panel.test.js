import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import { DomUtils, parseDocument } from 'htmlparser2';
import { createAIReference } from '../src/ai-edit.js';
import { templates } from '../src/templates.js';

let server, AIEditPanel, ArticleEditor;
const article = { id: 'panel_test', mode: 'raw', title: '标题', summary: '', blocks: [{ id: 'a', type: 'paragraph', runs: [{ text: '引用文字' }] }, { id: 'photo', type: 'imageCard', assetId: 'img_test', caption: '原图注' }] };
const assets = new Map([['img_test', { previewUrl: 'https://example.com/test.png' }]]);
const editor = values => ({ references: [], messages: [], prompt: '修改要求', busy: '', error: '', candidate: null, changes: [], invalidReferences: [], showCandidate: true, ...values });
const render = values => renderToStaticMarkup(React.createElement(AIEditPanel, { editor: editor(values), article, assets }));
const button = (html, name) => DomUtils.getElementsByTagName('button', parseDocument(html), true).find(element => element.attribs['aria-label'] === name || DomUtils.textContent(element).includes(name));

before(async () => {
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
  ({ AIEditPanel } = await server.ssrLoadModule('/src/AIEditPanel.jsx'));
  ({ ArticleEditor } = await server.ssrLoadModule('/src/ArticleEditor.jsx'));
});
after(async () => { await server?.close(); });

test('初始对话显示全文上下文，保留输入与发送入口', () => {
  const html = render({});
  assert.ok(html.includes('全文已作为上下文'));
  assert.ok(html.includes('引用用于提示关注点'));
  assert.ok(html.includes('aria-label="AI修改要求"'));
  assert.ok(button(html, '发送修改要求'));
  assert.equal(button(html, '应用本次修改'), undefined);
});

test('文字和图片卡片均提供独立×，失效引用保持展示并阻止发送', () => {
  const text = createAIReference(article, { kind: 'text', keys: ['block:a'], text: '引用文字' });
  const image = createAIReference(article, { kind: 'image', keys: ['block:photo'], text: '原图注' });
  const html = render({ references: [text, image] });
  assert.ok(html.includes('引用图片缩略图'));
  assert.ok(button(html, '移除引用：引用文字'));
  assert.ok(button(html, '移除引用：原图注'));
  assert.equal(button(html, '发送修改要求').attribs.disabled, undefined);
  const invalid = { ...text, snapshot: 'outdated' };
  const stale = render({ references: [invalid, image], invalidReferences: [invalid] });
  assert.ok(stale.includes('已失效 · 点击×移除'));
  assert.ok(button(stale, '移除引用：引用文字'));
  assert.ok(Object.hasOwn(button(stale, '发送修改要求').attribs, 'disabled'));
});

test('候选展示程序计算的前后差异和确认入口，失效时禁用应用', () => {
  const values = { candidate: {}, changes: [{ key: 'block:a', label: '修改第1段', before: '原文', after: '候选文字' }], messages: [{ id: 'message', role: 'assistant', text: '提出方案', status: 'pending' }] };
  const html = render(values);
  assert.ok(html.includes('尚未写入正文'));
  assert.ok(html.includes('修改前'));
  assert.ok(html.includes('候选文字'));
  assert.equal(button(html, '应用本次修改').attribs.disabled, undefined);
  assert.ok(button(html, '查看原稿'));
  const stale = render({ ...values, problem: '目标内容变化' });
  assert.ok(stale.includes('方案已失效'));
  assert.ok(Object.hasOwn(button(stale, '应用本次修改').attribs, 'disabled'));
  assert.ok(button(stale, '取消方案'));
});

test('生成中提供停止按钮，失败后可以填回要求，模型文字按普通文本显示', () => {
  assert.ok(button(render({ busy: 'generating' }), '停止生成'));
  const html = render({ error: '原稿已保留', prompt: '', messages: [{ id: 'user', role: 'user', text: '上次要求' }, { id: 'assistant', role: 'assistant', text: '<script>不是可执行代码</script>' }] });
  assert.ok(button(html, '填回上次要求'));
  assert.equal(html.includes('<script>'), false);
});

test('三种文章模式的手动文字、段落与图片工具继续渲染', () => {
  for (const mode of ['create', 'polish', 'raw']) {
    const props = { article: { ...article, mode }, template: templates[0], assets };
    const html = renderToStaticMarkup(React.createElement(ArticleEditor, props));
    for (const label of ['加粗', '下划线', '文字颜色', '文字高亮颜色', '段落类型', '段落字号', '段落行距', '段后间距', '首行缩进', '插入图片']) assert.ok(html.includes(`aria-label="${label}"`));
    const imageHtml = renderToStaticMarkup(React.createElement(ArticleEditor, { ...props, activeKey: 'block:photo' }));
    for (const label of ['图片宽度', '替换图片', '删除图片']) assert.ok(imageHtml.includes(label));
  }
});
