import assert from 'node:assert/strict';
import test from 'node:test';
import { DomUtils, parseDocument } from 'htmlparser2';
import { ArticleSchema } from '../src/core.js';
import { AIEditRequestSchema, AIEditResponseSchema, buildAIEdit, createAIReference, describeAIEdit, mergeAIEdit, sameAIReference, validAIReference } from '../src/ai-edit.js';
import { renderArticle } from '../src/renderer.js';
import { templates } from '../src/templates.js';

const paragraph = (id, text) => ({ id, type: 'paragraph', runs: [{ text }] });
const article = () => ({ schemaVersion: 1, id: 'article_test', mode: 'raw', title: '原始标题', summary: '原始摘要', templateId: 'T01', settings: {}, createdAt: '2026-11-05T00:00:00.000Z', updatedAt: '2026-11-05T00:00:00.000Z', blocks: [paragraph('a', '2026年11月5日，保留第一段事实。'), paragraph('b', '第二段保持已有表达。'), { id: 'image', type: 'imageCard', assetId: 'img_test', caption: '真实图注', style: { imageWidth: 100 } }, paragraph('c', '最后一段。')] });
const edited = source => buildAIEdit(source, [{ type: 'updateBlock', block: { ...source.blocks[0], runs: [{ text: '2026年11月5日，优化第一段表达。', bold: true }] } }]);

test('三种模式允许编辑中的空段落、空标题和空列表项，保留空行且仍校验长度与控制字符', () => {
  for (const mode of ['create', 'polish', 'raw']) {
    const base = article();
    base.mode = mode;
    base.blocks.push(paragraph('blank', ''), { id: 'heading', type: 'heading', level: 1, text: '', runs: [{ text: '' }] }, { id: 'list', type: 'list', ordered: false, items: [[{ text: '' }]] });
    assert.ok(AIEditRequestSchema.safeParse({ article: base, prompt: '修改第一段' }).success);
    assert.deepEqual(edited(base).blocks.slice(-3), base.blocks.slice(-3));
    for (const text of ['x'.repeat(1201), '\u0000']) {
      const invalid = structuredClone(base);
      invalid.blocks.at(-3).runs[0].text = text;
      assert.equal(AIEditRequestSchema.safeParse({ article: invalid, prompt: '修改' }).success, false);
    }
  }
});

test('候选不改原稿，原文模式支持改写和格式，AI修改标记可保存', () => {
  const base = article();
  const original = structuredClone(base);
  const next = edited(base);
  assert.deepEqual(base, original);
  assert.equal(next.mode, 'raw');
  assert.deepEqual(next.blocks.slice(1), base.blocks.slice(1));
  assert.equal(next.blocks[0].runs[0].bold, true);
  assert.equal(ArticleSchema.parse({ ...next, settings: { aiEdited: true } }).settings.aiEdited, true);
});

test('对象字段顺序不产生虚假改动，也不会使引用或手动样式失效', () => {
  const base = article();
  base.blocks[1] = { type: 'paragraph', runs: [{ bold: true, text: '第二段' }], style: { align: 'center', fontSize: 18 }, id: 'b' };
  const next = edited(base);
  assert.deepEqual(describeAIEdit(base, next).map(change => change.key), ['block:a']);
  const reference = createAIReference(base, { kind: 'text', keys: ['block:b'], text: '第二段' });
  const current = structuredClone(base);
  current.blocks[1] = { id: 'b', style: { fontSize: 18, align: 'center' }, type: 'paragraph', runs: [{ text: '第二段', bold: true }] };
  assert.ok(validAIReference(current, reference));
  assert.deepEqual(mergeAIEdit(base, next, current).blocks[1].style, { fontSize: 18, align: 'center' });
});

test('候选保留其他段落、标题和设置的手动编辑，不恢复用户删除的无关段落', () => {
  const base = article();
  const current = structuredClone(base);
  current.title = '手动新标题';
  current.settings.accountName = '新账号名';
  current.blocks[1].runs = [{ text: '用户手动修改第二段。' }];
  current.blocks.pop();
  const merged = mergeAIEdit(base, edited(base), current);
  assert.equal(merged.title, current.title);
  assert.deepEqual(merged.settings, current.settings);
  assert.deepEqual(merged.blocks[1], current.blocks[1]);
  assert.equal(merged.blocks.some(block => block.id === 'c'), false);
  assert.equal(merged.blocks[0].runs[0].bold, true);
});

test('目标内容、目标样式、模板或文章变化时拒绝覆盖', () => {
  const base = article();
  for (const change of [
    current => { current.blocks[0].runs[0].text = '手动输入'; },
    current => { current.blocks[0].style = { fontSize: 18 }; },
    current => { current.blocks.shift(); },
    current => { current.templateId = 'T02'; },
    current => { current.id = 'another'; },
  ]) {
    const current = structuredClone(base);
    change(current);
    assert.throws(() => mergeAIEdit(base, edited(base), current), /已失效/);
  }
});

test('支持增删段落、移动缩放图片，影响范围来自实际差异且不把自然位移算成改动', () => {
  const base = article();
  const next = buildAIEdit(base, [
    { type: 'removeBlock', id: 'b' },
    { type: 'insertBlock', afterId: 'a', block: paragraph('new', '新增说明。') },
    { type: 'updateBlock', block: { ...base.blocks[2], style: { imageWidth: 60, align: 'center' } } },
    { type: 'moveBlock', id: 'image', afterId: null },
  ]);
  assert.deepEqual(mergeAIEdit(base, next, base), next);
  assert.deepEqual(next.blocks.map(block => block.id), ['image', 'a', 'new', 'c']);
  const changes = describeAIEdit(base, next);
  assert.ok(changes.some(change => change.key === 'block:b' && change.label.startsWith('删除')));
  assert.ok(changes.some(change => change.key === 'block:new'));
  assert.ok(changes.some(change => change.key === 'block:image' && change.label.includes('位置')));
  assert.ok(changes.some(change => change.after.includes('图片宽度：60%')));
  assert.equal(changes.some(change => change.key === 'block:c'), false);
  const current = structuredClone(base);
  current.blocks[3].runs[0].text = '手动修改末段';
  current.blocks.push(paragraph('manual', '手动新增末段'));
  const merged = mergeAIEdit(base, next, current);
  assert.equal(merged.blocks.find(block => block.id === 'c').runs[0].text, '手动修改末段');
  assert.equal(merged.blocks.at(-1).id, 'manual');
});

test('任意段落重排能够完整合并，且并发重排不能被覆盖', () => {
  const base = article();
  const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map(rest => [value, ...rest])) : [[]];
  for (const blocks of permutations(base.blocks)) {
    const next = { ...base, blocks };
    assert.deepEqual(mergeAIEdit(base, next, base).blocks.map(block => block.id), blocks.map(block => block.id));
  }
  const moved = buildAIEdit(base, [{ type: 'moveBlock', id: 'image', afterId: null }]);
  const current = structuredClone(base);
  current.blocks.reverse();
  assert.throws(() => mergeAIEdit(base, moved, current), /已失效/);
});

test('重排仅移动当前段落，所有排列都保留并发文字和样式，不复活手动删除的段落', () => {
  const base = article();
  const permutations = values => values.length ? values.flatMap((value, index) => permutations(values.filter((_, at) => at !== index)).map(rest => [value, ...rest])) : [[]];
  for (const blocks of permutations(base.blocks)) {
    const next = { ...base, blocks };
    for (const target of base.blocks) {
      const current = structuredClone(base);
      const manual = current.blocks.find(block => block.id === target.id);
      manual.style = { ...manual.style, align: 'right' };
      if (manual.runs) manual.runs = [{ text: '用户刚刚输入，必须保留。' }];
      const merged = mergeAIEdit(base, next, current);
      assert.deepEqual(merged.blocks.map(block => block.id), blocks.map(block => block.id));
      assert.deepEqual(merged.blocks.find(block => block.id === target.id), manual);
    }
  }
  const reversed = { ...base, blocks: [...base.blocks].reverse() };
  const deleted = { ...base, blocks: base.blocks.filter(block => block.id !== 'b') };
  assert.throws(() => mergeAIEdit(base, reversed, deleted), /已失效/);
  const changed = buildAIEdit(base, [{ type: 'updateBlock', block: paragraph('b', 'AI修改第二段。') }, { type: 'moveBlock', id: 'b', afterId: null }]);
  const manual = structuredClone(base);
  manual.blocks[1].runs[0].text = '用户也修改了第二段。';
  assert.throws(() => mergeAIEdit(base, changed, manual), /已失效/);
});

test('普通修改校验实际文字与底色，40套模板均拒绝同色正文及同色高亮', () => {
  for (const template of templates) {
    const base = { ...article(), templateId: template.id };
    assert.throws(() => buildAIEdit(base, [{ type: 'updateBlock', block: { ...base.blocks.at(-1), runs: [{ text: '不能与页面同色。', color: template.tokens.page || '#FFFFFF' }] } }]), /对比度/);
    assert.throws(() => buildAIEdit(base, [{ type: 'updateBlock', block: { ...base.blocks.at(-1), runs: [{ text: '不能与高亮同色。', color: '#FFFFFF', highlight: '#FFFFFF' }] } }]), /对比度/);
    assert.doesNotThrow(() => buildAIEdit(base, [{ type: 'updateBlock', block: { ...base.blocks.at(-1), runs: [{ text: '深色高亮上的白字可读。', color: '#FFFFFF', highlight: '#111111' }] } }]));
  }
});

test('无关的已有低对比度手动文字不阻断修改，合并后仍拒绝新引入的不可读文字', () => {
  const base = article();
  base.blocks.at(-1).runs[0].color = templates[0].tokens.page;
  const next = edited(base);
  assert.deepEqual(next.blocks.at(-1), base.blocks.at(-1));
  const invalid = structuredClone(next);
  invalid.blocks[0].runs[0].color = templates[0].tokens.page;
  assert.throws(() => mergeAIEdit(base, invalid, base), /对比度/);
  assert.throws(() => buildAIEdit(base, [{ type: 'updateBlock', block: { ...base.blocks.at(-1), runs: [base.blocks.at(-1).runs[0], base.blocks.at(-1).runs[0]] } }]), /对比度/);
});

test('定制版式校验实际分组底色和列表高亮，允许深底白字并拒绝继承底色上的同色文字', () => {
  const base = article();
  base.blocks.push({ id: 'list', type: 'list', ordered: false, items: [[{ text: '列表条目' }]] });
  const design = { version: 1, name: '深色内容分组', description: '深底白字', page: { backgroundColor: '#FFFFFF', color: '#26332F', fontFamily: 'sans', fontSize: 16, lineHeight: 1.9, paragraphGap: 18, paddingX: 16 }, rules: {}, nodes: [{ type: 'content', ref: 'title' }, { type: 'content', ref: 'summary' }, { type: 'group', style: { backgroundColor: '#111111', color: '#FFFFFF' }, children: base.blocks.map(block => ({ type: 'content', ref: `block:${block.id}` })) }] };
  const dark = buildAIEdit(base, [{ type: 'setLayout', design }]);
  assert.doesNotThrow(() => buildAIEdit(dark, [{ type: 'updateBlock', block: { ...dark.blocks[0], runs: [{ text: '深底上的白字。', color: '#FFFFFF' }] } }]));
  assert.throws(() => buildAIEdit(dark, [{ type: 'updateBlock', block: { ...dark.blocks[0], runs: [{ text: '深底上的同色字。', color: '#111111' }] } }]), /对比度/);
  assert.throws(() => buildAIEdit(dark, [{ type: 'updateBlock', block: { ...dark.blocks.at(-1), items: [[{ text: '高亮不能遮住白字。', highlight: '#FFFFFF' }]] } }]), /对比度/);
});

test('引用去重并保持原始快照；无关编辑不使引用失效，目标修改或删除会失效', () => {
  const base = article();
  const input = { kind: 'text', keys: ['block:a', 'block:b'], text: '第一段事实。\n第二段', startOffset: 12, endOffset: 3 };
  const reference = createAIReference(base, input);
  assert.ok(sameAIReference(reference, createAIReference(base, input)));
  assert.equal(sameAIReference(reference, createAIReference(base, { ...input, startOffset: 1 })), false);
  assert.ok(validAIReference(base, reference));
  const current = structuredClone(base);
  current.blocks[3].runs[0].text = '无关编辑';
  assert.ok(validAIReference(current, reference));
  current.blocks[1].runs[0].text = '引用已有变化';
  assert.equal(validAIReference(current, reference), false);
  current.blocks.shift();
  assert.equal(validAIReference(current, reference), false);
  const image = createAIReference(base, { kind: 'image', keys: ['block:image'], text: '真实图注' });
  assert.equal(image.assetId, 'img_test');
  assert.ok(sameAIReference(image, { ...image, text: '图片位置变化后的同一引用' }));
});

test('拒绝图片资源伪造、重复编号、无效目标和过量图片', () => {
  const base = article();
  assert.throws(() => buildAIEdit(base, [{ type: 'updateBlock', block: { ...base.blocks[2], assetId: 'img_forged' } }]), /不能替换图片资源/);
  assert.throws(() => buildAIEdit(base, [{ type: 'insertBlock', afterId: null, block: base.blocks[0] }]), /唯一编号/);
  assert.throws(() => buildAIEdit(base, [{ type: 'removeBlock', id: 'missing' }]), /不存在/);
  assert.throws(() => buildAIEdit(base, [{ type: 'moveBlock', id: 'a', afterId: 'a' }]), /自身/);
  assert.throws(() => buildAIEdit(base, Array.from({ length: 10 }, (_, index) => ({ type: 'insertBlock', afterId: null, block: { ...base.blocks[2], id: `image${index}` } }))), /10张/);
  assert.throws(() => AIEditResponseSchema.parse({ message: '尝试执行', operations: [{ type: 'eval', code: 'alert(1)' }] }));
});

test('整篇版式候选校验引用及可读性，确认时检查全文依赖', () => {
  const base = article();
  const design = { version: 1, name: '清晰留白', description: '保持层级', page: { backgroundColor: '#FFFFFF', color: '#26332F', fontFamily: 'sans', fontSize: 16, lineHeight: 1.9, paragraphGap: 18, paddingX: 16 }, rules: {}, nodes: ['title', 'summary', ...base.blocks.map(block => `block:${block.id}`)].map(ref => ({ type: 'content', ref })) };
  const next = buildAIEdit(base, [{ type: 'setLayout', design }]);
  assert.ok(describeAIEdit(base, next).some(change => change.label.includes('影响全文')));
  assert.deepEqual(mergeAIEdit(base, next, base).layoutDesign, design);
  const current = structuredClone(base);
  current.blocks[3].runs[0].text = '全文依赖已变化';
  assert.throws(() => mergeAIEdit(base, next, current), /已失效/);
  assert.throws(() => buildAIEdit(base, [{ type: 'setLayout', design: { ...design, nodes: design.nodes.slice(1) } }]), /全部内容/);
  assert.throws(() => buildAIEdit(base, [{ type: 'setLayout', design: { ...design, page: { ...design.page, color: '#FFFFFF' } } }]), /对比度/);
});

test('修改后的正文沿用全部40套模板渲染和复制，文字转义且图片宽度保留', () => {
  const base = article();
  const next = buildAIEdit(base, [{ type: 'updateBlock', block: paragraph('a', '<script>不是脚本</script> 保留正文') }, { type: 'updateBlock', block: { ...base.blocks[2], style: { imageWidth: 65, align: 'center' } } }]);
  const assets = new Map([['img_test', { url: 'https://example.com/test.png' }]]);
  for (const template of templates) {
    const output = renderArticle(next, template, assets);
    assert.ok(output.text.includes('<script>不是脚本</script>'));
    assert.ok(DomUtils.textContent(parseDocument(output.html)).includes('<script>不是脚本</script>'));
    assert.equal(output.html.includes('<script>'), false);
    assert.ok(output.html.includes('65%'));
    assert.equal(output.html.includes('data-preview-key'), false);
  }
});
