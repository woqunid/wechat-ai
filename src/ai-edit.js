import { z } from 'zod';
import { ArticleSchema, BlockSchema, blockText, uid } from './core.js';
import { LayoutDesignSchema, validateLayoutDesign } from './layout-design.js';
import { renderArticle } from './renderer.js';
import { getTemplate } from './templates.js';
import { unreadableText } from './readability.js';
import { articleWithHtml, cssDeclarations, findHtmlNode, htmlElements, htmlTree, innerHtml, nodeText, outerHtml, renderHtmlDocument, replaceHtmlNode, replaceHtmlReference, sanitizeHtml } from './html-document.js';

export const AI_EDIT_TIMEOUT_MS = 180_000;
const id = z.string().min(1).max(80);
const text = max => z.string().max(max).refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
export const AIReferenceSchema = z.object({
  id, kind: z.enum(['text', 'image']), keys: z.array(z.string().min(1).max(90)).min(1).max(122),
  text: text(180000), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional(),
  assetId: z.string().regex(/^img_[a-zA-Z0-9_-]{3,80}$/).optional(),
});
export const AIConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']), text: text(4000),
  references: z.array(AIReferenceSchema).max(100).optional(),
  targets: z.array(z.string().min(1).max(90)).max(160).optional(),
  status: z.enum(['pending', 'applied', 'discarded', 'superseded', 'failed', 'stopped', 'answered', 'reverted']).optional(),
});
const AIEditInputSchema = z.object({
  article: ArticleSchema, prompt: text(4000).refine(value => value.trim()),
  references: z.array(AIReferenceSchema).max(100).default([]),
  messages: z.array(AIConversationMessageSchema).max(16).default([]),
  attachments: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), name: text(240).min(1), assetId: id }).strict(),
    z.object({ kind: z.literal('document'), name: text(240).min(1), text: text(200_000), imageAssetIds: z.array(id).max(10).default([]) }).strict(),
  ])).max(5).default([]),
});
export const AIEditResponseSchema = z.object({
  message: text(4000).min(1),
  operations: z.array(z.discriminatedUnion('type', [
    z.object({ type: z.literal('setHtml'), html: z.string().max(600_000).min(1), intent: z.enum(['layout', 'content']).default('layout') }).strict(),
    z.object({ type: z.literal('replaceHtml'), referenceId: id.optional(), nodeId: id.optional(), startOffset: z.number().int().nonnegative().optional(), endOffset: z.number().int().nonnegative().optional(), html: z.string().max(600_000), intent: z.enum(['layout', 'content']).default('layout') }).strict(),
    z.object({ type: z.literal('setTitle'), text: text(80) }).strict(),
    z.object({ type: z.literal('setSummary'), text: text(120) }).strict(),
    z.object({ type: z.literal('updateBlock'), block: BlockSchema }).strict(),
    z.object({ type: z.literal('insertBlock'), afterId: id.nullable(), block: BlockSchema }).strict(),
    z.object({ type: z.literal('removeBlock'), id }).strict(),
    z.object({ type: z.literal('moveBlock'), id, afterId: id.nullable() }).strict(),
    z.object({ type: z.literal('setLayout'), design: LayoutDesignSchema }).strict(),
  ])).max(160),
}).strict();

export const AIEditRequestSchema = AIEditInputSchema.extend({
  pendingChanges: z.array(z.object({ index: z.number().int().positive(), key: text(90), label: text(160), before: text(300), after: text(300) })).max(1000).default([]),
  layoutRepair: z.object({ result: AIEditResponseSchema, issue: text(2000) }).strict().optional(),
});

export function aiEditConversation(messages) {
  return messages.filter(message => !['failed', 'stopped'].includes(message.status) && !(message.role === 'user' && message.status === 'pending')).slice(-16).map(message => AIConversationMessageSchema.parse({
    ...message, text: message.text.slice(0, 4000), references: message.references?.map(reference => ({ ...reference, text: reference.text.slice(0, 200) })),
  }));
}

export const aiEditSummary = (base, candidate) => describeAIEdit(base, candidate).slice(0, 1000).map((change, index) => ({ ...change, index: index + 1, before: change.before.slice(0, 300), after: change.after.slice(0, 300) }));

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
    if (isImageBlock(block) && !allowedAssets.has(block.assetId)) throw new Error('只能使用当前文章已有图片或本轮附件图片，不能生成图片资源');
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

export function buildAIEdit(article, operations, { references = [], assetIds = [] } = {}) {
  if (article.html) {
    let html = article.html;
    const used = new Set();
    for (const op of operations) {
      const before = html;
      if (op.type === 'setHtml') {
        html = op.html;
      } else if (op.type === 'replaceHtml') {
        if (Boolean(op.referenceId) === Boolean(op.nodeId)) throw new Error('局部修改必须指定一个真实选区或 HTML 节点');
        if (op.referenceId) {
          const reference = references.find(item => item.id === op.referenceId);
          if (!reference || used.has(reference.id)) throw new Error('请使用本轮真实选区编号，且每个选区只修改一次');
          if (op.startOffset !== undefined || op.endOffset !== undefined) throw new Error('引用选区已有边界，不应另设文字偏移');
          html = replaceHtmlReference(html, reference, op.html);
          used.add(reference.id);
        } else {
          const node = findHtmlNode(html, op.nodeId);
          if (!node) throw new Error('修改目标不存在，请使用当前 HTML 中的真实节点编号');
          if (op.startOffset === undefined && op.endOffset === undefined) html = replaceHtmlNode(html, op.nodeId, op.html, { preserveId: true });
          else {
            if (op.startOffset === undefined || op.endOffset === undefined || op.endOffset > nodeText(node).length) throw new Error('局部文字修改的起止偏移不完整或超出目标节点');
            html = replaceHtmlReference(html, { kind: 'text', keys: [`html:${op.nodeId}`], startOffset: op.startOffset, endOffset: op.endOffset, text: nodeText(node).slice(op.startOffset, op.endOffset) }, op.html);
          }
        }
      } else throw new Error('当前文章以 HTML 保存，请使用 setHtml 或 replaceHtml 操作');
      if (op.intent !== 'content' && nodeText(htmlTree(before)).replace(/\s/g, '') !== nodeText(htmlTree(html)).replace(/\s/g, '')) throw new Error('排版修改必须保留原文；只有用户明确要求改写时才可使用 intent:content');
    }
    if (!operations.length) return structuredClone(article);
    const safe = sanitizeHtml(html);
    if (renderHtmlDocument(safe, new Map(), { mode: 'source' }) === renderHtmlDocument(article.html, new Map(), { mode: 'source' })) throw new Error('方案没有产生有效变化，请修改实际生效的内联样式或内容');
    const allowed = new Set([...htmlElements(htmlTree(article.html)).filter(node => node.name === 'img').map(node => node.attribs['data-asset-id']), ...assetIds]);
    for (const node of htmlElements(htmlTree(safe))) if (node.name === 'img' && !allowed.has(node.attribs['data-asset-id'])) throw new Error('只能使用当前文章已有图片或本轮附件图片');
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
  const result = checkedArticle(next, new Set([...article.blocks.filter(isImageBlock).map(block => block.assetId), ...assetIds]));
  if (design) result.layoutDesign = validateLayoutDesign(design, result);
  return checkReadability(article, result);
}

export function aiEditTargets(operations, references = []) {
  return [...new Set(operations.flatMap(op => op.type === 'setHtml' ? ['article'] : op.type === 'replaceHtml' ? op.nodeId ? [`html:${op.nodeId}`] : references.find(reference => reference.id === op.referenceId)?.keys || [] : []))];
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

function mergeHtml(base, candidate, current, conflict) {
  const trees = [base, candidate, current].map(htmlTree);
  const maps = trees.map(tree => new Map(htmlElements(tree).map(node => [node.attribs['data-node-id'], node])));
  const parentId = node => node?.parent?.attribs?.['data-node-id'] || '$root';
  for (const [id, before] of maps[0]) {
    const proposed = maps[1].get(id), now = maps[2].get(id);
    if (proposed && now) {
      if (parentId(before) !== parentId(proposed) && parentId(before) !== parentId(now) && parentId(proposed) !== parentId(now)) conflict();
    } else if (proposed && parentId(before) !== parentId(proposed) || now && parentId(before) !== parentId(now)) conflict();
  }
  const serialized = node => node ? outerHtml(node) : '';
  const own = node => fingerprint([node.name, node.attribs, (node.children || []).map(child => child.type === 'tag' ? child.attribs['data-node-id'] : serialized(child))]);
  const merge = (before, proposed, now) => {
    if (serialized(before) === serialized(proposed)) return serialized(now);
    if (serialized(before) === serialized(now) || serialized(proposed) === serialized(now)) return serialized(proposed);
    if (!before) return conflict();
    if (!proposed) return serialized(before) === serialized(now) ? '' : conflict();
    if (!now) return serialized(before) === serialized(proposed) ? '' : conflict();
    if (before.name !== proposed.name || before.name !== now.name) return conflict();
    if (own(before) !== own(proposed) && own(before) !== own(now) && own(proposed) !== own(now)) return conflict();
    const source = own(before) !== own(proposed) ? proposed : now;
    for (const child of before.children || []) {
      const id = child.attribs?.['data-node-id'];
      if (id && (!maps[1].has(id) || !maps[2].has(id))) merge(...maps.map(map => map.get(id)));
    }
    const content = (source.children || []).map(child => child.type === 'tag' ? merge(...maps.map(map => map.get(child.attribs['data-node-id']))) : serialized(child)).join('');
    return source.type === 'root' ? content : serialized(source).replace(innerHtml(source), content);
  };
  return merge(...trees);
}

export function mergeAIEdit(base, candidate, current) {
  const conflict = () => { throw new Error('修改对象或相关排版已变化，此方案已失效，请取消方案后重新生成'); };
  if (base.html || candidate.html || current.html) {
    if (base.id !== current.id || !base.html || !candidate.html || !current.html || base.templateId !== current.templateId) conflict();
    const html = mergeHtml(base.html, candidate.html, current.html, conflict);
    return checkReadability(current, ArticleSchema.parse(articleWithHtml(current, html)));
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
  return checkReadability(current, checkedArticle(merged, new Set([...current.blocks, ...candidate.blocks].filter(isImageBlock).map(block => block.assetId))));
}

export function revertAIEdit(base, candidate, key) {
  if (key.startsWith('html:')) {
    const id = key.slice(5), original = findHtmlNode(base.html, id), proposed = findHtmlNode(candidate.html, id);
    let html = candidate.html;
    if (proposed) html = replaceHtmlNode(html, id, original ? outerHtml(original) : '');
    else if (original) {
      const siblings = original.parent.children;
      const following = siblings.slice(siblings.indexOf(original) + 1).find(node => node.attribs && findHtmlNode(html, node.attribs['data-node-id']));
      const parent = findHtmlNode(html, original.parent.attribs?.['data-node-id']);
      if (following) {
        const node = findHtmlNode(html, following.attribs['data-node-id']);
        html = replaceHtmlNode(html, node.attribs['data-node-id'], outerHtml(original) + outerHtml(node));
      } else if (parent) html = replaceHtmlNode(html, parent.attribs['data-node-id'], outerHtml(parent).replace(innerHtml(parent), innerHtml(parent) + outerHtml(original)));
      else if (original.parent.type === 'root') html += outerHtml(original);
      else throw new Error('原段落的容器已变化，请取消方案后重新生成');
    }
    return articleWithHtml(candidate, html);
  }
  const next = structuredClone(candidate);
  if (key === 'title' || key === 'summary') next[key] = base[key];
  else if (key === 'layout') next.layoutDesign = structuredClone(base.layoutDesign);
  else {
    const id = key.replace(/^block:/, ''), original = base.blocks.find(block => block.id === id);
    next.blocks = next.blocks.filter(block => block.id !== id);
    if (original) {
      const prior = base.blocks.slice(0, base.blocks.indexOf(original)).reverse().find(block => next.blocks.some(item => item.id === block.id));
      next.blocks.splice(prior ? next.blocks.findIndex(block => block.id === prior.id) + 1 : 0, 0, structuredClone(original));
    }
  }
  return next;
}

export function appliedAIEditStatus(base, next, current) {
  try { return describeAIEdit(current, mergeAIEdit(next, base, current)).length ? 'applied' : 'reverted'; } catch {}
  try { mergeAIEdit(base, next, current); return 'reverted'; } catch { return 'superseded'; }
}

const styleNames = { fontSize: '字号', align: '对齐', lineHeight: '行距', paragraphSpacing: '段距', itemSpacing: '列表项间距', indent: '首行缩进', imageWidth: '图片宽度', color: '文字颜色', backgroundColor: '背景色', fontFamily: '字体', fontWeight: '字重', letterSpacing: '字间距', textAlign: '对齐', marginTop: '上方间距', marginBottom: '下方间距', paddingX: '左右留白', paddingY: '上下留白', borderSide: '边框位置', borderWidth: '边框宽度', borderColor: '边框颜色', borderStyle: '边框样式', borderRadius: '圆角', paragraphGap: '段距' };
const styleValues = { left: '左', center: '居中', right: '右', justify: '两端', sans: '无衬线', serif: '衬线', mono: '等宽', all: '四周', top: '上', bottom: '下', solid: '实线', dashed: '虚线', double: '双线' };
const styleText = style => Object.entries(style || {}).map(([key, value]) => `${styleNames[key] || key}：${styleValues[value] || value}${key === 'imageWidth' ? '%' : ''}`).join('；');
const cssNames = { 'font-size': '字号', 'line-height': '行距', color: '文字颜色', 'background-color': '背景色', 'font-weight': '字重', 'font-family': '字体', 'text-align': '对齐', 'letter-spacing': '字间距', margin: '外间距', padding: '内留白', 'margin-bottom': '段后间距', 'margin-top': '段前间距', width: '宽度', 'max-width': '最大宽度', border: '边框', 'border-radius': '圆角' };
function htmlStyleChanges(before, after) {
  const originals = new Map((before ? htmlElements(before) : []).map(node => [node.attribs['data-node-id'], node]));
  return (after ? htmlElements(after) : []).flatMap(node => {
    const original = originals.get(node.attribs['data-node-id']);
    if (!original) return [];
    const a = Object.fromEntries(cssDeclarations(original.attribs.style)), b = Object.fromEntries(cssDeclarations(node.attribs.style));
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => a[key] !== b[key]).map(key => `${cssNames[key] || key}：${a[key] || '默认'} → ${b[key] || '默认'}`);
  });
}
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
const imageCount = text => text.split('\uFFFC').length - 1;
const addedImagesOnly = (before, after) => imageCount(after) > imageCount(before) && before.replace(/\uFFFC|\s/g, '') === after.replace(/\uFFFC|\s/g, '');
export function describeAIEdit(base, candidate) {
  if (base.html || candidate.html) {
    if (base.html === candidate.html) return [];
    const before = new Map(htmlElements(htmlTree(base.html)).map(node => [node.attribs['data-node-id'], node]));
    const after = new Map(htmlElements(htmlTree(candidate.html)).map(node => [node.attribs['data-node-id'], node]));
    const ownContent = node => node ? fingerprint([node.name, node.attribs, (node.children || []).map(child => child.type === 'text' ? child.data : child.attribs?.['data-node-id'])]) : '';
    const changed = [...new Set([...before.keys(), ...after.keys()])].filter(id => ownContent(before.get(id)) !== ownContent(after.get(id)));
    const top = changed.filter(id => { const node = after.get(id) || before.get(id); return !changed.includes(node.parent?.attribs?.['data-node-id']); });
    return top.map(id => {
      const original = nodeText(before.get(id) || htmlTree('')), proposed = nodeText(after.get(id) || htmlTree(''));
      const styles = htmlStyleChanges(before.get(id), after.get(id));
      return { key: `html:${id}`, label: !after.has(id) ? '删除段落' : addedImagesOnly(original, proposed) ? '插入图片' : !before.has(id) ? '新增段落' : original === proposed ? '调整自定义版式' : '修改内容与版式', before: original.slice(0, 800) || '空', after: [proposed.slice(0, 800) || '空', ...new Set(styles)].join('\n') };
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
    if (!base.blocks.some(item => item.id === block.id)) changes.push({ key: `block:${block.id}`, label: isImageBlock(block) ? `在第${index + 1}项插入图片` : `新增第${index + 1}段`, before: '无', after: blockDescription(block) });
    else if (moved.has(block.id)) changes.push({ key: `block:${block.id}`, label: `${isImageBlock(block) ? '图片' : '段落'}位置调整`, before: `第${base.blocks.findIndex(item => item.id === block.id) + 1}项`, after: `第${index + 1}项` });
  });
  if (!same(base.layoutDesign, candidate.layoutDesign)) changes.push({ key: 'layout', label: '调整整篇版式（影响全文）', before: layoutDescription(base.layoutDesign), after: layoutDescription(candidate.layoutDesign) });
  return changes;
}
