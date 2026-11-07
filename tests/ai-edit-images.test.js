import assert from 'node:assert/strict';
import { test } from 'node:test';
import { articleWithHtml } from '../src/html-document.js';
import { buildAIEdit, describeAIEdit, mergeAIEdit } from '../src/ai-edit.js';

const now = new Date().toISOString();
const article = { schemaVersion: 1, id: 'image-test', mode: 'create', title: '标题', summary: '', blocks: [{ id: 'b1', type: 'paragraph', runs: [{ text: '第一段' }] }, { id: 'b2', type: 'paragraph', runs: [{ text: '第二段' }] }], templateId: 'T01', settings: {}, createdAt: now, updatedAt: now };
const insert = { type: 'insertBlock', afterId: 'b1', block: { id: 'b_ai_1', type: 'imageCard', assetId: 'img_attach1', caption: '附件图' } };

test('AI 修改可插入本轮附件图片，其他图片仍被拒绝', () => {
  assert.throws(() => buildAIEdit(article, [insert]), /本轮附件图片/);
  const next = buildAIEdit(article, [insert], { assetIds: ['img_attach1'] });
  assert.deepEqual(next.blocks.map(block => block.id), ['b1', 'b_ai_1', 'b2']);
  assert.equal(describeAIEdit(article, next)[0].label, '在第2项插入图片');
  assert.deepEqual(mergeAIEdit(article, next, article).blocks.map(block => block.id), ['b1', 'b_ai_1', 'b2']);
});

test('HTML 文章可插入本轮附件图片', () => {
  const html = articleWithHtml(article, '<section data-node-id="page"><p data-node-id="p1">第一段</p></section>');
  const operation = { type: 'setHtml', intent: 'content', html: '<section data-node-id="page"><p data-node-id="p1">第一段</p><img data-node-id="pic" data-asset-id="img_attach1" alt="附件图"></section>' };
  assert.throws(() => buildAIEdit(html, [operation]), /本轮附件图片/);
  const next = buildAIEdit(html, [operation], { assetIds: ['img_attach1'] });
  assert.match(next.html, /data-asset-id="img_attach1"/);
  assert.equal(describeAIEdit(html, next)[0].label, '插入图片');
  assert.match(mergeAIEdit(html, next, html).html, /img_attach1/);
});
