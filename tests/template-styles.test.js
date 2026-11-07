import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderArticle } from '../src/renderer.js';
import { templates } from '../src/templates.js';
import { templateStyleProfiles } from '../src/template-style-profiles.js';

const article = {
  title: '一篇用于版式检查的文章',
  summary: '通过相同内容比较每套模板的正文风格。',
  blocks: [
    { id: 'heading', type: 'heading', level: 1, text: '从现象到方法' },
    { id: 'paragraph', type: 'paragraph', runs: [{ text: '同一段正文用于检查开篇与阅读节奏。' }] },
    { id: 'quote', type: 'quote', runs: [{ text: '设计要让信息更容易被理解。' }], cite: '编辑手记' },
    { id: 'list', type: 'list', ordered: false, items: [[{ text: '第一项' }], [{ text: '第二项' }]] },
    { id: 'callout', type: 'callout', runs: [{ text: '保留文章事实，清晰呈现重点。' }] },
    { id: 'divider', type: 'divider' },
    { id: 'image', type: 'image', assetId: 'missing-image', title: '配图', caption: '图片说明' },
  ],
};

test('40 套模板都用独立正文签名渲染完整文章块', () => {
  assert.equal(templates.length, 40);
  assert.ok(templates.every(template => !Object.hasOwn(template, 'styleProfile')));
  const signatures = templates.map(template => JSON.stringify(templateStyleProfiles[template.id]));
  assert.ok(signatures.every(Boolean));
  assert.equal(new Set(signatures).size, 40);
  for (const field of ['chapterLabel', 'summaryLabel', 'calloutLabel', 'dividerMark', 'footerLabel']) {
    assert.equal(new Set(templates.map(template => templateStyleProfiles[template.id][field])).size, 40, `${field} must be unique per template`);
  }

  const expectedText = renderArticle(article, templates[0]).text;
  for (const template of templates) {
    const rendered = renderArticle(article, template);
    const html = rendered.html;
    assert.equal(rendered.text, expectedText);
    const profile = templateStyleProfiles[template.id];
    for (const marker of [profile.chapterLabel, profile.summaryLabel, profile.quoteMark, profile.listMarker, profile.calloutLabel, profile.dividerMark, profile.footerLabel]) {
      assert.ok(html.includes(marker), `${template.id} did not render ${marker}`);
    }
  }
});
