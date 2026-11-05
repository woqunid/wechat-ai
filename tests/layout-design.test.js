import test from 'node:test';
import assert from 'node:assert/strict';
import { DomUtils, parseDocument } from 'htmlparser2';
import { ArticleSchema } from '../src/core.js';
import { clearArticleStyles, layoutLeaves, layoutSignature, layoutSource, validateLayoutDesign } from '../src/layout-design.js';
import { renderArticle } from '../src/renderer.js';
import { templates } from '../src/templates.js';

const article = {
  schemaVersion: 1, id: 'article_test', mode: 'raw', title: '把时间留给重要的事', summary: '从真实问题开始，改善工作节奏。', templateId: 'T01', settings: {},
  createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z',
  blocks: [
    { id: 'h1', type: 'heading', level: 1, text: '先识别问题' },
    { id: 'p1', type: 'paragraph', runs: [{ text: '截至11月5日，已完成40个项目。', bold: true, color: '#FF0000' }, { text: '\n保留限定条件，而不是只看数字。' }], style: { fontSize: 40, lineHeight: 1.2 } },
    { id: 'q1', type: 'quote', runs: [{ text: '把时间留给重要的事。' }], cite: '原始材料' },
    { id: 'l1', type: 'list', ordered: true, items: [[{ text: '记录现状' }], [{ text: '明确下一步' }]] },
    { id: 'c1', type: 'callout', runs: [{ text: '先处理真正重要的问题。' }] },
    { id: 'i1', type: 'imageCard', assetId: 'img_test', title: '现场记录', caption: '已有图注' },
    { id: 'i2', type: 'image', assetId: 'img_empty' },
    { id: 'd1', type: 'divider' },
  ],
};
const makeDesign = () => ({
  version: 1, name: '清晰阅读', description: '以留白和章节层级组织阅读。',
  page: { backgroundColor: '#FFFFFF', color: '#26332F', fontFamily: 'sans', fontSize: 16, lineHeight: 1.9, paragraphGap: 18, paddingX: 16 },
  rules: { title: { color: '#FFFFFF', backgroundColor: '#173B33', paddingX: 16, paddingY: 24 }, heading: { borderSide: 'left', borderColor: '#173B33', paddingX: 10 } },
  nodes: layoutSource(article).map(item => ({ type: 'content', ref: item.ref })),
});
const leaf = (design, ref) => layoutLeaves(design.nodes).find(node => node.ref === ref);
const visibleText = html => DomUtils.textContent(parseDocument(html));

test('提交完整语义内容，去掉原模板及手动视觉样式', () => {
  const source = layoutSource(article);
  assert.equal(source.length, article.blocks.length + 2);
  assert.equal(source[3].text, article.blocks[1].runs.map(run => run.text).join(''));
  assert.equal(source[4].cite, '原始材料');
  assert.deepEqual(source[5].items, ['记录现状', '明确下一步']);
  const serialized = JSON.stringify(source);
  for (const field of ['templateId', 'fontSize', 'lineHeight', 'bold', '#FF0000']) assert.ok(!serialized.includes(field));
  const changedStyle = structuredClone(article);
  changedStyle.blocks[1].runs[0].color = '#000000';
  assert.equal(layoutSignature(changedStyle), layoutSignature(article));
});

test('允许新分组，并将设计随文章保存和恢复', () => {
  const design = makeDesign();
  design.nodes = [{ type: 'group', style: { borderSide: 'bottom', borderColor: '#173B33' }, children: design.nodes.slice(0, 2) }, ...design.nodes.slice(2)];
  const checked = validateLayoutDesign(design, article);
  const recovered = ArticleSchema.parse(JSON.parse(JSON.stringify({ ...article, layoutDesign: checked })));
  assert.deepEqual(recovered.layoutDesign, checked);
});

test('遗漏、重复、重排或增加引用均被拒绝', () => {
  for (const mutate of [design => design.nodes.pop(), design => design.nodes.push(design.nodes[0]), design => design.nodes.reverse(), design => design.nodes[0].ref = 'block:unknown']) {
    const design = makeDesign();
    mutate(design);
    assert.throws(() => validateLayoutDesign(design, article), /原顺序/);
  }
});

test('拒绝任意CSS、脚本、固定宽高及超范围字号', () => {
  for (const style of [{ position: 'fixed' }, { display: 'none' }, { width: 1000 }, { backgroundColor: 'url(https://example.com)' }, { color: 'red\" onclick=\"alert(1)' }, { fontSize: 100 }]) {
    const design = makeDesign();
    leaf(design, 'block:p1').style = style;
    assert.throws(() => validateLayoutDesign(design, article), /超出约束/);
  }
});

test('拒绝低对比度与不适合长文的实际字号、行距', () => {
  for (const style of [{ color: '#EEEEEE' }, { backgroundColor: '#26332F' }, { fontSize: 14 }, { fontSize: 24 }, { lineHeight: 1.5 }]) {
    const design = makeDesign();
    leaf(design, 'block:p1').style = style;
    assert.throws(() => validateLayoutDesign(design, article), /对比度|正文字号/);
  }
  const design = makeDesign();
  design.page.color = '#CCCCCC';
  assert.throws(() => validateLayoutDesign(design, article), /对比度/);
});

test('检查分组继承的颜色、字号与累计横向留白', () => {
  for (const style of [{ color: '#EEEEEE' }, { fontSize: 32 }]) {
    const design = makeDesign();
    const index = design.nodes.findIndex(node => node.ref === 'block:p1');
    design.nodes[index] = { type: 'group', style, children: [design.nodes[index]] };
    assert.throws(() => validateLayoutDesign(design, article), /对比度|正文字号/);
  }
  const design = makeDesign();
  design.nodes = [{ type: 'group', style: { paddingX: 20 }, children: [{ type: 'group', style: { paddingX: 20 }, children: design.nodes }] }];
  assert.throws(() => validateLayoutDesign(design, article), /内边距/);
});

test('重点只能引用对应内容的连续原文，并限制强调密度', () => {
  const design = makeDesign();
  leaf(design, 'block:p1').emphasis = ['40个项目'];
  validateLayoutDesign(design, article);
  leaf(design, 'block:p1').emphasis = ['虚构的结论'];
  assert.throws(() => validateLayoutDesign(design, article), /连续原文/);
  leaf(design, 'block:p1').emphasis = [layoutSource(article)[3].text.replace('\n', '')];
  assert.throws(() => validateLayoutDesign(design, article), /连续原文|重点过多/);
});

test('预览和复制使用相同排版，正文、列表、引用和图注全部保留', () => {
  const design = validateLayoutDesign(makeDesign(), article);
  leaf(design, 'block:p1').emphasis = ['40个项目'];
  const input = { ...clearArticleStyles(article), layoutDesign: design };
  const assets = new Map([['img_test', { url: 'https://example.com/photo.png', previewUrl: 'https://example.com/photo.png' }]]);
  const copied = renderArticle(input, templates[0], assets);
  const preview = renderArticle(input, templates[0], assets, { mode: 'preview', interactive: true });
  assert.equal(preview.html.replace(/ data-preview-key="[^"]*"/g, ''), copied.html);
  assert.equal(copied.text, renderArticle(article, templates[0], assets).text);
  const text = visibleText(copied.html);
  for (const item of layoutSource(article)) for (const value of [item.text, item.cite, item.title, item.caption, ...(item.items || [])].filter(Boolean)) assert.ok(text.includes(value), value);
  assert.ok(copied.html.includes('<strong style="font-weight:700;">40个项目</strong>'));
  assert.ok(!copied.html.includes('#FF0000'));
  assert.ok(!copied.html.includes('font-size:40px'));
  assert.ok(!copied.html.includes('data-preview-key'));
  assert.ok(!text.includes('READING / ESSAY'));
});

test('编辑、增加、删除、重排内容后仍完整呈现当前全文', () => {
  const design = makeDesign();
  const edited = structuredClone(article);
  edited.blocks[1].runs = [{ text: '新的正文内容，保留当前修改。' }];
  edited.blocks.splice(2, 1);
  edited.blocks.unshift({ id: 'new', type: 'paragraph', runs: [{ text: '新增的开篇。' }] });
  edited.blocks.reverse();
  const html = renderArticle({ ...edited, layoutDesign: design }, templates[0]).html;
  const text = visibleText(html);
  let offset = 0;
  for (const item of layoutSource(edited)) {
    const value = item.text || item.items?.[0] || item.title;
    if (!value) continue;
    const at = text.indexOf(value, offset);
    assert.ok(at >= offset, value);
    offset = at + value.length;
  }
  assert.ok(!text.includes('原始材料'));
});

test('应用时清理旧视觉样式，不改原文及撤销源；之后的手动调整继续生效', () => {
  const before = structuredClone(article);
  const cleared = clearArticleStyles(article);
  assert.equal(layoutSignature(cleared), layoutSignature(article));
  assert.deepEqual(article, before);
  assert.deepEqual(cleared.blocks[1].runs, article.blocks[1].runs.map(run => ({ text: run.text })));
  assert.equal(cleared.blocks[1].style, undefined);
  cleared.blocks[1].style = { fontSize: 18, align: 'center', paragraphSpacing: 24 };
  cleared.blocks[1].runs[0].color = '#004477';
  const html = renderArticle({ ...cleared, layoutDesign: makeDesign() }, templates[0]).html;
  assert.ok(html.includes('font-size:18px;'));
  assert.ok(html.includes('text-align:center;'));
  assert.ok(html.includes('color:#004477;'));
});

test('结构变化后保留原分组的字体、前景色和背景色，避免白字失去深色底', () => {
  const design = makeDesign();
  design.nodes = [{ type: 'group', style: { color: '#FFFFFF', backgroundColor: '#173B33', fontFamily: 'serif' }, children: design.nodes }];
  validateLayoutDesign(design, article);
  const edited = clearArticleStyles(article);
  edited.blocks.push({ id: 'added', type: 'paragraph', runs: [{ text: '新增内容仍然完整。' }] });
  const html = renderArticle({ ...edited, layoutDesign: design }, templates[0]).html;
  assert.ok(html.includes('color:#FFFFFF;background-color:#173B33;'));
  assert.ok(visibleText(html).includes('新增内容仍然完整。'));
});

test('正文中的HTML被转义，图片遵守复制HTTPS规则，无图注不新增说明', () => {
  const edited = structuredClone(article);
  edited.blocks[1].runs = [{ text: '<script>alert("x")</script> & 保留原文' }];
  const design = makeDesign();
  const assets = new Map([['img_empty', { previewUrl: 'blob:test', url: '/uploads/local.png' }]]);
  const copied = renderArticle({ ...edited, layoutDesign: design }, templates[0], assets).html;
  const preview = renderArticle({ ...edited, layoutDesign: design }, templates[0], assets, { mode: 'preview' }).html;
  assert.ok(copied.includes('&lt;script&gt;'));
  assert.ok(!copied.includes('<script>'));
  assert.ok(!copied.includes('src="blob:'));
  assert.ok(preview.includes('src="blob:test"'));
  const imageHtml = preview.slice(preview.indexOf('src="blob:test"'));
  assert.ok(!imageHtml.includes('图 02'));
  assert.ok(!imageHtml.includes('font-size:13px'));
});
