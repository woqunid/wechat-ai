import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArticleSchema } from '../src/core.js';
import { AIConversationMessageSchema, AIEditRequestSchema, aiEditTargets, buildAIEdit, createAIReference, describeAIEdit, mergeAIEdit, validAIReference } from '../src/ai-edit.js';
import { ensureHtmlArticle, reconcileHtmlArticle } from '../src/document-model.js';
import { articleWithHtml, findHtmlNode, htmlElements, htmlTree, nodeText, outerHtml, sanitizeHtml } from '../src/html-document.js';
import { clearArticleStyles } from '../src/layout-design.js';
import { renderArticle } from '../src/renderer.js';
import { templates } from '../src/templates.js';

const base = () => ({ schemaVersion: 1, id: 'html-test', mode: 'create', title: '标题', summary: '', blocks: [{ id: 'old-body', type: 'paragraph', runs: [{ text: '正文' }] }], templateId: 'T01', settings: {}, createdAt: '2026-11-05T00:00:00Z', updatedAt: '2026-11-05T00:00:00Z' });
const document = () => articleWithHtml(base(), '<section data-node-id="page" style="color:#26332F;background-color:#FFFFFF;padding:16px;"><p data-node-id="title" data-preview-key="title">标题</p><p data-node-id="first" style="margin:0 0 12px;">保留<strong data-node-id="bold">选中文字</strong>结尾</p><p data-node-id="second">其他段落</p></section>');

test('旧文章按原模板迁移，所有模板保存和重新打开不丢内容或图片', () => {
  for (const template of templates) {
    const old = { ...base(), templateId: template.id, blocks: [...base().blocks, { id: 'old-image', type: 'imageCard', assetId: 'img_test', caption: '图注' }] };
    const next = ensureHtmlArticle(old);
    assert.equal(next.title, '标题');
    assert.equal(next.blocks.filter(block => block.type === 'paragraph').map(block => block.runs.map(run => run.text).join('')).join(''), '正文');
    assert.equal(next.blocks.filter(block => block.type === 'imageCard').length, 1);
    assert.equal(ArticleSchema.safeParse(next).success, true);
    assert.equal(ensureHtmlArticle(JSON.parse(JSON.stringify(next))).html, next.html);
    const preview = renderArticle(next, template).html;
    assert.ok(!preview.includes('data-node-id'));
  }
});

test('自定义分组与内联样式直接保存，预览和复制共用 HTML', () => {
  const current = document();
  const next = buildAIEdit(current, [{ type: 'setHtml', html: current.html.replace('padding:16px;', 'padding:7px;border:1px dashed #26332F;border-radius:13px;') }]);
  assert.match(next.html, /border-radius:13px/);
  const applied = mergeAIEdit(current, next, current);
  assert.equal(renderArticle(applied, templates[0]).html, renderArticle(applied, templates[0], new Map(), { mode: 'preview' }).html);
  assert.equal(describeAIEdit(current, next).length, 1);
  assert.equal(current.html, document().html);
  assert.throws(() => mergeAIEdit(current, next, articleWithHtml(current, current.html.replace('其他段落', '手动修改'))), /失效/);
});

test('部分文字选区只替换对应文字，保留其他段落及边界样式', () => {
  const current = document();
  const reference = createAIReference(current, { kind: 'text', keys: ['html:first'], text: '选中文字', startOffset: 2, endOffset: 6 });
  assert.ok(validAIReference(current, reference));
  const next = buildAIEdit(current, [{ type: 'replaceHtml', referenceId: reference.id, intent: 'content', html: '<span style="color:#A6372C;">修改后的字</span>' }], { references: [reference] });
  assert.equal(nodeText(findHtmlNode(next.html, 'first')), '保留修改后的字结尾');
  assert.equal(outerHtml(findHtmlNode(next.html, 'second')), outerHtml(findHtmlNode(current.html, 'second')));
  assert.equal(findHtmlNode(next.html, 'first').attribs.style, findHtmlNode(current.html, 'first').attribs.style);
  assert.throws(() => buildAIEdit(current, [{ type: 'replaceHtml', referenceId: 'invented', html: '' }], { references: [reference] }), /真实选区/);
});

test('完整列表选区可以改变整个列表的结构和内部间距', () => {
  const current = articleWithHtml(base(), '<section data-node-id="list"><p>01 第一项</p><p>02 第二项</p></section><p data-node-id="other">保留其他内容</p>');
  const reference = createAIReference(current, { kind: 'text', keys: ['html:list'], text: '01 第一项02 第二项', startOffset: 0, endOffset: 12 });
  const next = buildAIEdit(current, [{ type: 'replaceHtml', referenceId: reference.id, html: '<section data-node-id="list" style="border:1px solid #26332F;"><p style="margin:0;padding:0;">01 第一项</p><p style="margin:0;padding:0;">02 第二项</p></section>' }], { references: [reference] });
  assert.equal(outerHtml(findHtmlNode(next.html, 'other')), outerHtml(findHtmlNode(current.html, 'other')));
  assert.match(next.html, /margin:0;padding:0/);
});

test('跨段落与换行选区保留边界外文字', () => {
  const current = articleWithHtml(base(), '<section data-node-id="root"><p data-node-id="a">甲<br>乙😀</p><p data-node-id="b">丙丁</p><p data-node-id="c">末段</p></section>');
  const reference = createAIReference(current, { kind: 'text', keys: ['html:root'], text: '\n乙😀丙', startOffset: 1, endOffset: 6 });
  const next = buildAIEdit(current, [{ type: 'replaceHtml', referenceId: reference.id, intent: 'content', html: '<p>新文字</p>' }], { references: [reference] });
  assert.equal(nodeText(findHtmlNode(next.html, 'root')), '甲新文字丁末段');
  assert.equal(outerHtml(findHtmlNode(next.html, 'c')), outerHtml(findHtmlNode(current.html, 'c')));
});

test('过滤脚本、事件和不兼容样式，拒绝未知图片', () => {
  const html = sanitizeHtml('<section onclick="bad()" style="position:fixed;display:grid;padding:8px;background-image:url(https://bad);height:100px;"><script>bad()</script><style>p{display:none}</style><p>安全文字</p><iframe src="https://bad"></iframe></section>');
  assert.ok(!/onclick|script|iframe|url|fixed|grid|height:100px/.test(html));
  assert.match(html, /padding:8px/);
  assert.throws(() => sanitizeHtml('<img src="https://bad/image.png">'), /已有的资源/);
  assert.throws(() => buildAIEdit(document(), [{ type: 'setHtml', intent: 'content', html: '<img data-asset-id="img_unknown">' }]), /只能使用当前文章已有图片/);
  const elements = htmlElements(htmlTree(sanitizeHtml('<p data-node-id="same">一</p><p data-node-id="same">二</p>')));
  assert.equal(new Set(elements.map(node => node.attribs['data-node-id'])).size, elements.length);
});

test('图片库替换保留自定义样式，图片插入与删除同步到 HTML', () => {
  const current = articleWithHtml(base(), '<section><p data-node-id="body">正文</p><img data-node-id="image" data-asset-id="img_first" style="width:65%;border-radius:12px;"></section>');
  const next = reconcileHtmlArticle(current, { ...current, blocks: current.blocks.map(block => block.id === 'image' ? { ...block, assetId: 'img_second' } : block) });
  assert.match(next.html, /img_second/);
  assert.match(findHtmlNode(next.html, 'image').attribs.style, /width:65%;border-radius:12px/);
  const inserted = reconcileHtmlArticle(next, { ...next, blocks: [...next.blocks, { id: 'new-image', type: 'imageCard', assetId: 'img_third' }] });
  assert.equal(inserted.blocks.filter(block => block.assetId).length, 2);
  const deleted = reconcileHtmlArticle(inserted, { ...inserted, blocks: inserted.blocks.filter(block => block.assetId !== 'img_third') });
  assert.ok(!deleted.html.includes('img_third'));
  assert.equal(AIEditRequestSchema.safeParse({ article: next, prompt: '缩小图片' }).success, true);
});

test('模板和独立版式可重新生成 HTML，原稿保留供撤销', () => {
  const original = document();
  const next = reconcileHtmlArticle(original, { ...original, html: undefined, layoutDesign: undefined, templateId: 'T06' });
  assert.equal(next.templateId, 'T06');
  assert.notEqual(next.html, original.html);
  assert.ok(!clearArticleStyles(original).html);
  assert.equal(document().html, original.html);
});

test('模板切换的内容摘要保留标题级别、无序列表和引用', () => {
  const old = { ...base(), blocks: [{ id: 'head', type: 'heading', level: 2, text: '小标题' }, { id: 'list', type: 'list', ordered: false, items: [[{ text: '条目' }]] }, { id: 'quote', type: 'quote', runs: [{ text: '引用' }], cite: '出处' }] };
  const next = ensureHtmlArticle(ensureHtmlArticle(old));
  assert.deepEqual(next.blocks.map(block => block.type), ['heading', 'list', 'quote']);
  assert.equal(next.blocks[0].level, 2);
  assert.equal(next.blocks[1].ordered, false);
  assert.equal(next.blocks[2].cite, '出处');
});

test('只排版时拦截原文变化，无效 HTML 修改不产生假方案', () => {
  const current = document();
  assert.throws(() => buildAIEdit(current, [{ type: 'setHtml', html: current.html.replace('其他段落', '擅自改写') }]), /必须保留原文/);
  assert.throws(() => buildAIEdit(current, [{ type: 'setHtml', html: current.html.replace('padding:16px;', 'padding:16px;position:fixed;') }]), /没有产生有效变化/);
});

test('任意 HTML 的混合图文和长文字摘要不会截断正文', () => {
  const current = articleWithHtml(base(), '<section>前文<p data-node-id="p" data-preview-key="block:old" data-block-type="paragraph" data-editor-part="runs">图片前<img data-asset-id="img_test">图片后</p>后文</section>');
  assert.equal(current.blocks.filter(block => block.runs).flatMap(block => block.runs).map(run => run.text).join(''), '前文图片前图片后后文');
  assert.equal(current.blocks.filter(block => block.assetId).length, 1);
  const long = articleWithHtml(base(), `<h1>${'😀'.repeat(800)}</h1>`);
  assert.ok(ArticleSchema.safeParse(long).success);
  assert.equal(long.blocks.flatMap(block => block.runs).map(run => run.text).join(''), '😀'.repeat(800));
});

test('图片邻接的局部文字修改不复制或删除图片', () => {
  const current = articleWithHtml(base(), '<section><p data-node-id="target">甲<img data-node-id="image" data-asset-id="img_test">乙</p></section>');
  const reference = createAIReference(current, { kind: 'text', keys: ['html:target'], text: '甲', startOffset: 0, endOffset: 1 });
  const next = buildAIEdit(current, [{ type: 'replaceHtml', referenceId: reference.id, html: '<strong>甲</strong>' }], { references: [reference] });
  assert.equal(htmlElements(htmlTree(next.html)).filter(node => node.name === 'img').length, 1);
  assert.equal(nodeText(findHtmlNode(next.html, 'target')), '甲\uFFFC乙');
});

test('AI 图片尺寸修改可应用，复制时使用登记的 HTTPS 地址', () => {
  const current = articleWithHtml(base(), '<section><img data-node-id="image" data-asset-id="img_test" style="width:100%;"></section>');
  const reference = createAIReference(current, { kind: 'image', keys: ['html:image'], text: '文章图片' });
  assert.equal(reference.assetId, 'img_test');
  const next = buildAIEdit(current, [{ type: 'replaceHtml', referenceId: reference.id, html: '<img data-node-id="image" data-asset-id="img_test" style="width:50%;">' }], { references: [reference] });
  const assets = new Map([['img_test', { url: 'https://example.com/image.png', previewUrl: 'blob:preview' }]]);
  const rendered = renderArticle(next, templates[0], assets);
  assert.match(rendered.html, /width:50%/);
  assert.match(rendered.html, /src="https:\/\/example.com\/image.png"/);
  assert.ok(!rendered.html.includes('data-asset-id'));
  const loading = renderArticle(next, templates[0], new Map(), { mode: 'preview', interactive: true }).html;
  assert.match(loading, /data-asset-id="img_test"/);
  assert.equal(articleWithHtml(next, loading).blocks.filter(block => block.assetId === 'img_test').length, 1);
});

test('历史图片失效后显示补图占位，保留正文和已保存样式', () => {
  const current = articleWithHtml(base(), '<section style="padding:24px;"><p style="color:#334455;">保留正文</p><img data-asset-id="img_test" alt="配图" style="width:65%;"></section>');
  const savedHtml = current.html;
  const assets = new Map([['img_test', { id: 'img_test', pasteStatus: 'broken' }]]);
  const preview = renderArticle(current, templates[0], assets, { mode: 'preview' }).html;
  assert.match(preview, /保留正文/);
  assert.match(preview, /padding:24px/);
  assert.match(preview, /color:#334455/);
  assert.match(preview, /图片待补充：配图/);
  assert.ok(!preview.includes('<img'));
  assert.equal(current.html, savedHtml);
});

test('AI 无需选区可定位节点，连续修改保留目标编号与边界外内容', () => {
  const original = document();
  const operations = [{ type: 'replaceHtml', nodeId: 'first', html: '<p style="margin:0 0 4px;">保留<strong>选中文字</strong>结尾</p>' }];
  const next = buildAIEdit(original, operations);
  assert.match(findHtmlNode(next.html, 'first').attribs.style, /margin:0 0 4px/);
  assert.equal(outerHtml(findHtmlNode(next.html, 'second')), outerHtml(findHtmlNode(original.html, 'second')));
  assert.deepEqual(aiEditTargets(operations), ['html:first']);
  const followup = buildAIEdit(next, [{ type: 'replaceHtml', nodeId: 'first', startOffset: 2, endOffset: 6, html: '<span style="font-weight:700;">选中文字</span>' }]);
  assert.equal(nodeText(findHtmlNode(followup.html, 'first')), '保留选中文字结尾');
  assert.equal(outerHtml(findHtmlNode(followup.html, 'second')), outerHtml(findHtmlNode(original.html, 'second')));
  assert.throws(() => buildAIEdit(original, [{ type: 'replaceHtml', nodeId: 'unknown', html: '' }]), /真实节点/);
  assert.throws(() => buildAIEdit(original, [{ type: 'replaceHtml', nodeId: 'first', startOffset: 2, html: '' }]), /起止偏移/);
  assert.throws(() => buildAIEdit(original, [{ type: 'replaceHtml', nodeId: 'first', startOffset: 2, endOffset: 200, html: '' }]), /超出目标节点/);
});

test('对话保留历史选区、实际修改目标与方案状态，明确全文要求可覆盖引用范围', () => {
  const original = document();
  const reference = createAIReference(original, { kind: 'text', keys: ['html:first'], text: '选中文字', startOffset: 2, endOffset: 6 });
  const message = AIConversationMessageSchema.parse({ role: 'user', text: '把这里加粗', references: [reference], retryReferences: [reference] });
  assert.equal(message.references[0].keys[0], 'html:first');
  assert.equal(message.references[0].snapshot, undefined);
  assert.equal(message.retryReferences, undefined);
  const targets = aiEditTargets([{ type: 'replaceHtml', referenceId: reference.id }], [reference]);
  assert.deepEqual(targets, ['html:first']);
  const parsed = AIEditRequestSchema.parse({ article: original, prompt: '这里再紧凑一点', messages: [message, { role: 'assistant', text: '已生成第一段方案', targets, status: 'applied' }] });
  assert.deepEqual(parsed.messages[1].targets, ['html:first']);
  assert.equal(parsed.messages[1].status, 'applied');
  const full = [{ type: 'setHtml', html: original.html.replace('padding:16px;', 'padding:8px;') }];
  assert.match(buildAIEdit(original, full, { references: [reference] }).html, /padding:8px/);
  assert.deepEqual(aiEditTargets(full), ['article']);
});
