import { z } from 'zod';
import { ArticleSchema, BlockSchema, blockText, uid } from './core.js';
import { LayoutDesignSchema, validateLayoutDesign } from './layout-design.js';
import { renderArticle } from './renderer.js';
import { getTemplate } from './templates.js';
import { unreadableText } from './readability.js';
import { articleWithHtml, findHtmlNode, htmlElements, htmlTree, nodeText, outerHtml, renderHtmlDocument, replaceHtmlReference, sanitizeHtml } from './html-document.js';

export const AI_EDIT_TIMEOUT_MS = 180_000;
const id = z.string().min(1).max(80);
const text = max => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export const AIReferenceSchema = z.object({
  id, kind: z.enum(['text', 'image']), keys: z.array(z.string().min(1).max(90)).min(1).max(122),
  text: text(180000), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional(),
});
export const AIEditRequestSchema = z.object({
  article: ArticleSchema, prompt: text(4000).refine(value => value.trim()),
  references: z.array(AIReferenceSchema).max(100).default([]),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), text: text(4000) })).max(16).default([]),
  attachments: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), name: text(240).min(1), assetId: id }).strict(),
    z.object({ kind: z.literal('document'), name: text(240).min(1), text: text(200_000), imageAssetIds: z.array(id).max(10).default([]) }).strict(),
  ])).max(5).default([]),
  scope: z.enum(['selection', 'article']).default('article'),
});
export const AIEditResponseSchema = z.object({
  message: text(4000).min(1),
  operations: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('setHtml'), html: z.string().max(600_000).min(1), intent: z.enum(['layout', 'content']).default('layout') }).strict(),
    z.object({ type: z.literal('replaceHtml'), referenceId: id, html: z.string().max(600_000), intent: z.enum(['layout', 'content']).default('layout') }).strict(),
    z.object({ type: z.literal('setTitle'), text: text(80) }).strict(),
    z.object({ type: z.literal('setSummary'), text: text(120) }).strict(),
    z.object({ type: z.literal('updateBlock'), block: BlockSchema }).strict(),
    z.object({ type: z.literal('insertBlock'), afterId: id.nullable(), block: BlockSchema }).strict(),
    z.object({ type: z.literal('removeBlock'), id }).strict(),
    z.object({ type: z.literal('moveBlock'), id, afterId: id.nullable() }).strict(),
    z.object({ type: z.literal('setLayout'), design: LayoutDesignSchema }).strict(),
  ])).max(160),
}).strict();

const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const fingerprint = value => JSON.stringify(ordered(value));
const same = (a, b) => fingerprint(a) === fingerprint(b);
export const isImageBlock = block => ['image', 'imageCard'].includes(block?.type);
const part = (article, key) => key.startsWith('html:') ? (findHtmlNode(article.html, key.slice(5)) ? outerHtml(findHtmlNode(article.html, key.slice(5))) : undefined) : key === 'title' || key === 'summary' ? article[key] : article.blocks.find(block => `block:${block.id}` === key);
const referenceSnapshot = (article, keys) => {
  const values = keys.map(key => part(article, key));
  return values.some(value => value === undefined) ? null : fingerprint(values);
};
export function createAIReference(article, value) {
  const snapshot = referenceSnapshot(article, value.keys);
  if (!snapshot || !value.text?.trim()) return null;
  const reference = AIReferenceSchema.parse({ ...value, id: uid('ref') });
  return { ...reference, snapshot, ...(value.kind === 'image' ? { assetId: value.keys[0]?.startsWith('html:') ? findHtmlNode(article.html, value.keys[0].slice(5))?.attribs['data-asset-id'] : part(article, value.keys[0])?.assetId } : {}) };
}
export const validAIReference = (article, reference) => reference.snapshot === referenceSnapshot(article, reference.keys);
export const sameAIReference = (a, b) => a.kind === 'image' && b.kind === 'image' ? same(a.keys, b.keys) : same([a.kind, a.keys, a.text, a.startOffset, a.endOffset], [b.kind, b.keys, b.text, b.startOffset, b.endOffset]);

function checkedArticle(article, allowedAssets) {
  const parsed = ArticleSchema.parse(article);
  if (!parsed.blocks.length) throw new Error('正文至少保留一个内容段落');
  if (new Set(parsed.blocks.map(block => block.id)).size !== parsed.blocks.length) throw new Error('内容段落编号不能重复');
  if (parsed.blocks.filter(isImageBlock).length > 10) throw new Error('正文最多添加10张图片');
  for (const block of parsed.blocks) {
    if (isImageBlock(block) && !allowedAssets.has(block.assetId)) throw new Error('只能使用当前文章已有图片，不能生成或替换图片资源');
    if (block.type === 'heading' && block.runs && block.runs.map(run => run.text).join('') !== block.text) throw new Error('标题文字和文字格式内容不一致');
  }
  return parsed;
}

function checkReadability(before, after) {
  const problems = article => unreadableText(renderArticle(article, getTemplate(article.templateId), new Map(), { mode: 'preview', interactive: true }).html);
  const existing = problems(before);
  const problem = [...problems(after)].find(([key, count]) => count > (existing.get(key) || 0));
  if (problem) throw new Error(`${JSON.parse(problem[0])[0]} 修改后的文字与背景或高亮的对比度不足 4.5，请调整文字或底色`);
  return after;
}

export function buildAIEdit(article, operations, { references = [], scope = 'article' } = {}) {
  if (article.html) {
    let html = article.html;
    const used = new Set();
    for (const op of operations) {
      const before = html;
      if (op.type === 'setHtml') {
        if (scope === 'selection') throw new Error('当前只允许修改选区，请使用 replaceHtml');
        html = op.html;
      } else if (op.type === 'replaceHtml') {
        const reference = references.find(item => item.id === op.referenceId);
        if (!reference || used.has(reference.id)) throw new Error('请使用本轮真实选区编号，且每个选区只修改一次');
        html = replaceHtmlReference(html, reference, op.html);
        used.add(reference.id);
      } else throw new Error('当前文章以 HTML 保存，请使用 setHtml 或 replaceHtml 操作');
      if (op.intent !== 'content' && nodeText(htmlTree(before)).replace(/\s/g, '') !== nodeText(htmlTree(html)).replace(/\s/g, '')) throw new Error('排版修改必须保留原文；只有用户明确要求改写时才可使用 intent:content');
    }
    if (!operations.length) return structuredClone(article);
    const safe = sanitizeHtml(html);
    if (renderHtmlDocument(safe, new Map(), { mode: 'source' }) === renderHtmlDocument(article.html, new Map(), { mode: 'source' })) throw new Error('方案没有产生有效变化，请修改实际生效的内联样式或内容');
    const allowed = new Set(htmlElements(htmlTree(article.html)).filter(node => node.name === 'img').map(node => node.attribs['data-asset-id']));
    for (const node of htmlElements(htmlTree(safe))) if (node.name === 'img' && !allowed.has(node.attribs['data-asset-id'])) throw new Error('只能使用当前文章已有图片，请先从图片库插入图片');
    return checkReadability(article, ArticleSchema.parse(articleWithHtml(article, safe)));
  }
  const next = structuredClone(article);
  const indexOf = blockId => {
    const index = next.blocks.findIndex(block => block.id === blockId);
    if (index < 0) throw new Error('需要修改的段落不存在，请使用全文中的真实编号');
    return index;
  };
  let design;
  for (const op of operations) {
    if (op.type === 'setTitle') next.title = op.text;
    else if (op.type === 'setSummary') next.summary = op.text;
    else if (op.type === 'setLayout') design = op.design;
    else if (op.type === 'updateBlock') {
      const index = indexOf(op.block.id);
      if (isImageBlock(next.blocks[index]) && isImageBlock(op.block) && next.blocks[index].assetId !== op.block.assetId) throw new Error('图片仅支持调整尺寸和位置，不能替换图片资源');
      next.blocks[index] = structuredClone(op.block);
    }
    else if (op.type === 'removeBlock') next.blocks.splice(indexOf(op.id), 1);
    else if (op.type === 'insertBlock' || op.type === 'moveBlock') {
      if (op.type === 'insertBlock' && next.blocks.some(block => block.id === op.block.id)) throw new Error('新增段落必须使用新的唯一编号');
      if (op.type === 'moveBlock' && op.id === op.afterId) throw new Error('段落不能移动到自身之后');
      const block = op.type === 'moveBlock' ? next.blocks.splice(indexOf(op.id), 1)[0] : structuredClone(op.block);
      const index = op.afterId === null ? 0 : indexOf(op.afterId) + 1;
      next.blocks.splice(index, 0, block);
    }
  }
  const result = checkedArticle(next, new Set(article.blocks.filter(isImageBlock).map(block => block.assetId)));
  if (design) result.layoutDesign = validateLayoutDesign(design, result);
  return checkReadability(article, result);
}

function movedBlocks(before, after) {
  const oldIds = before.map(block => block.id).filter(blockId => after.some(block => block.id === blockId));
  const ids = after.map(block => block.id).filter(blockId => oldIds.includes(blockId));
  const lengths = Array.from({ length: oldIds.length + 1 }, () => Array(ids.length + 1).fill(0));
  for (let a = oldIds.length - 1; a >= 0; a--) for (let b = ids.length - 1; b >= 0; b--) {
    lengths[a][b] = oldIds[a] === ids[b] ? lengths[a + 1][b + 1] + 1 : Math.max(lengths[a + 1][b], lengths[a][b + 1]);
  }
  const stable = new Set();
  let a = 0, b = 0;
  while (a < oldIds.length && b < ids.length) {
    if (oldIds[a] === ids[b]) { stable.add(oldIds[a]); a++; b++; }
    else if (lengths[a + 1][b] >= lengths[a][b + 1]) a++;
    else b++;
  }
  return new Set(ids.filter(blockId => !stable.has(blockId)));
}

function reorderedBlocks(before, after) {
  const oldIds = before.map(block => block.id).filter(blockId => after.some(block => block.id === blockId));
  const ids = after.map(block => block.id).filter(blockId => oldIds.includes(blockId));
  return new Set(ids.filter((blockId, index) => blockId !== oldIds[index]));
}

export function mergeAIEdit(base, candidate, current) {
  const conflict = () => { throw new Error('修改对象或相关排版已变化，此方案已失效，请取消方案后重新生成'); };
  if (base.html || candidate.html || current.html) {
    if (base.id !== current.id || base.html !== current.html || base.templateId !== current.templateId) conflict();
    return { ...current, ...articleWithHtml(current, candidate.html), settings: current.settings };
  }
  if (base.id !== current.id || base.templateId !== current.templateId || !same(base.layoutDesign, current.layoutDesign)) conflict();
  const merged = structuredClone(current);
  for (const field of ['title', 'summary']) if (base[field] !== candidate[field]) {
    if (base[field] !== current[field]) conflict();
    merged[field] = candidate[field];
    if (merged[`${field}Format`]) delete merged[`${field}Format`].runs;
  }
  const before = new Map(base.blocks.map(block => [block.id, block]));
  const after = new Map(candidate.blocks.map(block => [block.id, block]));
  const now = new Map(current.blocks.map(block => [block.id, block]));
  const moved = movedBlocks(base.blocks, candidate.blocks);
  const structural = moved.size || base.blocks.some(block => !after.has(block.id)) || candidate.blocks.some(block => !before.has(block.id));
  if (structural) {
    const expected = base.blocks.filter(block => now.has(block.id)).map(block => block.id);
    if (!same(expected, current.blocks.filter(block => before.has(block.id)).map(block => block.id))) conflict();
  }
  if (!same(base.layoutDesign, candidate.layoutDesign)) {
    if (!same(base.blocks, current.blocks) || base.title !== current.title || base.summary !== current.summary) conflict();
    merged.layoutDesign = structuredClone(candidate.layoutDesign);
  }
  for (const [blockId, original] of before) {
    const proposed = after.get(blockId);
    if (!same(original, proposed)) {
      if (!same(original, now.get(blockId))) conflict();
      const index = merged.blocks.findIndex(block => block.id === blockId);
      if (!proposed) merged.blocks.splice(index, 1);
      else merged.blocks[index] = structuredClone(proposed);
    }
  }
  for (let index = 0; index < candidate.blocks.length; index++) {
    const block = candidate.blocks[index];
    if (before.has(block.id) && !moved.has(block.id)) continue;
    if (!before.has(block.id) && now.has(block.id)) conflict();
    const previousId = candidate.blocks[index - 1]?.id;
    if (previousId && !merged.blocks.some(item => item.id === previousId)) conflict();
    const from = merged.blocks.findIndex(item => item.id === block.id);
    if (before.has(block.id) && from < 0) conflict();
    const moving = from >= 0 ? merged.blocks.splice(from, 1)[0] : structuredClone(block);
    const at = previousId ? merged.blocks.findIndex(item => item.id === previousId) + 1 : 0;
    merged.blocks.splice(at, 0, moving);
  }
  return checkReadability(current, checkedArticle(merged, new Set(current.blocks.filter(isImageBlock).map(block => block.assetId))));
}

const styleNames = { fontSize: '字号', align: '对齐', lineHeight: '行距', paragraphSpacing: '段距', itemSpacing: '列表项间距', indent: '首行缩进', imageWidth: '图片宽度', color: '文字颜色', backgroundColor: '背景色', fontFamily: '字体', fontWeight: '字重', letterSpacing: '字间距', textAlign: '对齐', marginTop: '上方间距', marginBottom: '下方间距', paddingX: '左右留白', paddingY: '上下留白', borderSide: '边框位置', borderWidth: '边框宽度', borderColor: '边框颜色', borderStyle: '边框样式', borderRadius: '圆角', paragraphGap: '段距' };
const styleValues = { left: '左', center: '居中', right: '右', justify: '两端', sans: '无衬线', serif: '衬线', mono: '等宽', all: '四周', top: '上', bottom: '下', solid: '实线', dashed: '虚线', double: '双线' };
const styleText = style => Object.entries(style || {}).map(([key, value]) => `${styleNames[key] || key}：${styleValues[value] || value}${key === 'imageWidth' ? '%' : ''}`).join('；');
function blockDescription(block) {
  const names = { paragraph: '正文', heading: '标题', list: '列表', quote: '引用', callout: '重点', image: '图片', imageCard: '图片', divider: '分隔线' };
  const formats = [...(block.runs || []), ...(block.items || []).flat()].filter(run => run.bold || run.underline || run.color || run.highlight).map(run => `“${run.text}”：${[run.bold && '加粗', run.underline && '下划线', run.color && `文字色${run.color}`, run.highlight && `高亮${run.highlight}`].filter(Boolean).join('、')}`);
  const kind = block.type === 'heading' ? `${block.level}级标题` : block.type === 'list' ? block.ordered ? '有序列表' : '要点列表' : names[block.type];
  return [kind, blockText(block), block.cite, styleText(block.style), ...formats].filter(Boolean).join('\n');
}
function layoutDescription(design) {
  if (!design) return '使用当前模板';
  const nodes = values => values.flatMap(node => node.type === 'group' ? [`分组：${styleText(node.style)}`, ...nodes(node.children)] : [`${node.ref === 'title' ? '标题' : node.ref === 'summary' ? '摘要' : '内容段落'}：${styleText(node.style)}${node.emphasis?.length ? `；强调：${node.emphasis.join('、')}` : ''}`]);
  return [design.name, styleText(design.page), ...Object.entries(design.rules).map(([type, style]) => `${({ title: '标题', summary: '摘要', heading: '小标题', paragraph: '正文', quote: '引用', list: '列表', image: '图片', callout: '重点', divider: '分隔线' })[type]}：${styleText(style)}`), ...nodes(design.nodes)].join('\n');
}
export function describeAIEdit(base, candidate) {
  if (base.html || candidate.html) {
    if (base.html === candidate.html) return [];
    const before = new Map(htmlElements(htmlTree(base.html)).map(node => [node.attribs['data-node-id'], node]));
    const after = new Map(htmlElements(htmlTree(candidate.html)).map(node => [node.attribs['data-node-id'], node]));
    const ownContent = node => node ? fingerprint([node.name, node.attribs, (node.children || []).map(child => child.type === 'text' ? child.data : child.attribs?.['data-node-id'])]) : '';
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(id => ownContent(before.get(id)) !== ownContent(after.get(id)));
    const top = changed.filter(id => { const node = after.get(id) || before.get(id); return !changed.includes(node.parent?.attribs?.['data-node-id']); });
    return top.slice(0, 30).map(id => {
      const original = nodeText(before.get(id) || htmlTree('')), proposed = nodeText(after.get(id) || htmlTree(''));
      return { key: `html:${id}`, label: original === proposed ? '调整自定义版式' : '修改内容与版式', before: original.slice(0, 800) || '空', after: `${proposed.slice(0, 800) || '空'}${original === proposed ? '\n（样式已调整，请在画布对比）' : ''}` };
    });
  }
  const changes = [];
  for (const [key, label] of [['title', '修改文章标题'], ['summary', '修改摘要']]) if (base[key] !== candidate[key]) changes.push({ key, label, before: base[key], after: candidate[key] });
  const moved = reorderedBlocks(base.blocks, candidate.blocks);
  base.blocks.forEach((block, index) => {
    const next = candidate.blocks.find(item => item.id === block.id);
    if (!same(block, next)) changes.push({ key: `block:${block.id}`, label: `${next ? '修改' : '删除'}第${index + 1}${isImageBlock(block) ? '项图片' : '段'}`, before: blockDescription(block), after: next ? blockDescription(next) : '已删除' });
  });
  candidate.blocks.forEach((block, index) => {
    if (!base.blocks.some(item => item.id === block.id)) changes.push({ key: `block:${block.id}`, label: `新增第${index + 1}段`, before: '无', after: blockDescription(block) });
    else if (moved.has(block.id)) changes.push({ key: `block:${block.id}`, label: `${isImageBlock(block) ? '图片' : '段落'}位置调整`, before: `第${base.blocks.findIndex(item => item.id === block.id) + 1}项`, after: `第${index + 1}项` });
  });
  if (!same(base.layoutDesign, candidate.layoutDesign)) changes.push({ key: 'layout', label: '调整整篇版式（影响全文）', before: layoutDescription(base.layoutDesign), after: layoutDescription(candidate.layoutDesign) });
  return changes;
}
