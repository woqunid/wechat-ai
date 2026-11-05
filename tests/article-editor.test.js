import assert from 'node:assert/strict';
import test from 'node:test';
import { DomUtils, parseDocument } from 'htmlparser2';
import { articleField, ArticleSchema } from '../src/core.js';
import { editorBlocks, editorContent, editorHtml, editorKey } from '../src/editor-dom.js';
import { clearArticleStyles, layoutSource } from '../src/layout-design.js';
import { renderArticle } from '../src/renderer.js';
import { buildAIEdit, mergeAIEdit } from '../src/ai-edit.js';
import { templates } from '../src/templates.js';

const article = () => ({ schemaVersion: 1, id: 'article_editor', mode: 'raw', title: '统一编辑标题', summary: '摘要原文', templateId: 'T01', settings: {}, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', blocks: [{ id: 'b_first', type: 'paragraph', runs: [{ text: '第一段正文。' }] }] });
const formatted = () => ({ ...article(), titleFormat: { style: { align: 'center', fontSize: 32 }, runs: [{ text: '统一编辑', underline: true }, { text: '标题' }] }, summaryFormat: { style: { align: 'right', fontSize: 18 }, runs: [{ text: '摘要原文', bold: true }] } });
const descendants = (node, tag) => DomUtils.getElementsByTagName(tag, node, true);
const anchor = (doc, key) => DomUtils.findOne(node => node.attribs?.['data-preview-key'] === key, doc.children, true);

test('统一编辑区按标题、摘要、正文排列，引用键保持兼容且文字格式可随草稿往返', () => {
  const source = formatted();
  const blocks = editorBlocks(source);
  assert.deepEqual(blocks.map(block => editorKey(block.id)), ['title', 'summary', 'block:b_first']);
  const saved = ArticleSchema.parse({ ...source, ...editorContent(blocks) });
  assert.deepEqual(saved, source);
  const html = editorHtml(source, new Map(), templates[0]);
  const doc = parseDocument(html);
  const title = DomUtils.findOne(node => node.attribs?.['data-editor-part'] === 'runs', anchor(doc, 'title').children, true);
  assert.ok(title);
  assert.equal(descendants(doc, 'textarea').length, 0);
  assert.equal(DomUtils.textContent(title), source.title);
  assert.equal(saved.blocks.length, 1);
});

test('清空标题或摘要不删除正文，空字段仍可在统一编辑区填写', () => {
  const source = article();
  const blocks = editorBlocks(source).filter(block => !block.field);
  const next = { ...source, ...editorContent(blocks) };
  assert.equal(next.title, '');
  assert.equal(next.summary, '');
  assert.deepEqual(next.blocks, source.blocks);
  const doc = parseDocument(editorHtml(next, new Map(), templates[0]));
  assert.ok(anchor(doc, 'title'));
  assert.ok(anchor(doc, 'summary'));
  assert.ok(anchor(doc, 'block:b_first'));
});

test('40套模板的预览与复制均保留标题和摘要的对齐、字号与局部格式', () => {
  const source = formatted();
  for (const template of templates) {
    const preview = renderArticle(source, template, new Map(), { mode: 'preview', interactive: true });
    const copy = renderArticle(source, template);
    assert.equal(copy.text, [source.title, source.summary, '第一段正文。'].join('\n\n'));
    const doc = parseDocument(preview.html);
    const title = descendants(anchor(doc, 'title'), 'p').find(node => DomUtils.textContent(node) === source.title);
    const summary = descendants(anchor(doc, 'summary'), 'p').find(node => DomUtils.textContent(node) === source.summary);
    assert.ok(title.attribs.style.includes('text-align:center;'));
    assert.ok(title.attribs.style.includes('font-size:32px;'));
    assert.ok(summary.attribs.style.includes('text-align:right;'));
    assert.ok(summary.attribs.style.includes('font-size:18px;'));
    for (const html of [preview.html, copy.html]) {
      assert.ok(html.includes('text-decoration:underline'));
      assert.ok(html.includes('font-weight:700;'));
    }
  }
});

test('AI定制版式同样保留标题摘要的手动格式，重新设计可清除格式且不改文字', () => {
  const source = formatted();
  source.layoutDesign = { version: 1, name: '测试版式', description: '连续排版', page: { backgroundColor: '#FFFFFF', color: '#26332F', fontFamily: 'sans', fontSize: 16, lineHeight: 1.9, paragraphGap: 18, paddingX: 16 }, rules: {}, nodes: layoutSource(source).map(item => ({ type: 'content', ref: item.ref })) };
  const doc = parseDocument(renderArticle(source, templates[0], new Map(), { mode: 'preview', interactive: true }).html);
  assert.ok(anchor(doc, 'title').attribs.style.includes('text-align:center;'));
  assert.ok(anchor(doc, 'summary').attribs.style.includes('text-align:right;'));
  assert.ok(DomUtils.getOuterHTML(anchor(doc, 'title')).includes('text-decoration:underline'));
  const plain = clearArticleStyles(source);
  assert.equal(plain.titleFormat, undefined);
  assert.equal(plain.summaryFormat, undefined);
  assert.deepEqual(layoutSource(plain), layoutSource(source));
});

test('AI修改保留无关标题摘要格式，更换文字后不读回旧的格式文字', () => {
  const source = formatted();
  const next = buildAIEdit(source, [{ type: 'setTitle', text: '新的标题' }]);
  assert.equal(articleField(next, 'title').runs.map(run => run.text).join(''), '新的标题');
  assert.deepEqual(next.summaryFormat, source.summaryFormat);
  const merged = mergeAIEdit(source, next, source);
  assert.deepEqual(merged.titleFormat.style, source.titleFormat.style);
  assert.equal(merged.titleFormat.runs, undefined);
  assert.equal(articleField(merged, 'title').runs[0].text, '新的标题');
});
