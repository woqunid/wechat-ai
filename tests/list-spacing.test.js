import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseDocument } from 'htmlparser2';
import { buildAIEdit, mergeAIEdit, describeAIEdit } from '../src/ai-edit.js';
import { renderArticle } from '../src/renderer.js';
import { templates } from '../src/templates.js';

const article = {
  schemaVersion: 1, id: 'spacing', mode: 'create', title: '', summary: '',
  templateId: 'T01', settings: {}, createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z',
  blocks: [{ id: 'list', type: 'list', ordered: true, items: [[{ text: '第一项' }], [{ text: '第二项' }]], style: { paragraphSpacing: 3 } }],
};
const design = {
  version: 1, name: '测试', description: '列表间距',
  page: { backgroundColor: '#FFFFFF', color: '#26332F', fontFamily: 'sans', fontSize: 16, lineHeight: 1.9, paragraphGap: 18, paddingX: 16 },
  rules: {}, nodes: [{ type: 'content', ref: 'block:list' }],
};
const paragraphs = html => {
  const result = [];
  const visit = node => {
    if (node.name === 'p' && /第[一二]项/.test(JSON.stringify(node.children, (key, value) => ['parent', 'prev', 'next'].includes(key) ? undefined : value))) result.push(node.attribs.style);
    for (const child of node.children || []) visit(child);
  };
  visit(parseDocument(html));
  return result;
};

test('AI 列表项间距通过校验、应用，并同步渲染到预览和复制 HTML', () => {
  for (const layoutDesign of [undefined, design]) {
    const base = { ...article, layoutDesign };
    for (const itemSpacing of [0, 6]) {
      const block = { ...base.blocks[0], style: { paragraphSpacing: 3, itemSpacing } };
      const candidate = buildAIEdit(base, [{ type: 'updateBlock', block }]);
      const applied = mergeAIEdit(base, candidate, base);
      assert.equal(applied.blocks[0].style.itemSpacing, itemSpacing);
      assert.match(describeAIEdit(base, candidate)[0].after, /列表项间距/);
      for (const template of templates) {
        const preview = renderArticle(applied, template, new Map(), { mode: 'preview' }).html;
        assert.equal(preview, renderArticle(applied, template).html);
        const rows = paragraphs(preview);
        assert.equal(rows.length, 2);
        if (layoutDesign) {
          assert.match(rows[1], new RegExp(`margin:${itemSpacing}px 0 0;`));
          assert.match(preview, /margin-bottom:3px/);
        } else {
          assert.ok(rows[0].includes(`margin:0 0 ${itemSpacing}px;padding-top:0;padding-bottom:0;`));
          assert.ok(rows[1].includes('margin:0 0 0px;padding-top:0;padding-bottom:0;'));
          assert.match(preview, /margin:18px 0 3px/);
        }
      }
    }
  }
});
