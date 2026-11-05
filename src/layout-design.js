import { z } from 'zod';

export const LAYOUT_TIMEOUT_MS = 120_000;
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const label = max => z.string().min(1).max(max).refine(value => !/[\u0000-\u001f\u007f]/.test(value));
export const LayoutStyleSchema = z.object({
  color: color.optional(), backgroundColor: color.optional(),
  fontFamily: z.enum(['sans', 'serif', 'mono']).optional(),
  fontSize: z.number().min(14).max(34).optional(),
  fontWeight: z.union([z.literal(400), z.literal(600), z.literal(700), z.literal(800)]).optional(),
  lineHeight: z.number().min(1.5).max(2.3).optional(),
  letterSpacing: z.number().min(0).max(1).optional(),
  textAlign: z.enum(['left', 'center', 'right', 'justify']).optional(),
  marginTop: z.number().min(0).max(40).optional(), marginBottom: z.number().min(0).max(40).optional(),
  paddingX: z.number().min(0).max(20).optional(), paddingY: z.number().min(0).max(28).optional(),
  borderSide: z.enum(['all', 'left', 'top', 'bottom']).optional(),
  borderWidth: z.number().min(1).max(4).optional(),
  borderColor: color.optional(), borderStyle: z.enum(['solid', 'dashed', 'double']).optional(),
  borderRadius: z.number().min(0).max(20).optional(),
}).strict();
const contentNode = z.object({
  type: z.literal('content'), ref: label(90), style: LayoutStyleSchema.optional(),
  emphasis: z.array(label(100)).max(5).optional(),
}).strict();
let nodeSchema = contentNode;
for (let depth = 0; depth < 3; depth++) {
  nodeSchema = z.union([contentNode, z.object({
    type: z.literal('group'), style: LayoutStyleSchema.optional(), children: z.array(nodeSchema).min(1).max(122),
  }).strict()]);
}
export const LayoutDesignSchema = z.object({
  version: z.literal(1), name: label(30), description: label(180),
  page: z.object({
    backgroundColor: color, color, fontFamily: z.enum(['sans', 'serif', 'mono']),
    fontSize: z.number().min(15).max(18), lineHeight: z.number().min(1.7).max(2.2),
    paragraphGap: z.number().min(12).max(28), paddingX: z.number().min(12).max(20),
  }).strict(),
  rules: z.object(Object.fromEntries(['title', 'summary', 'heading', 'paragraph', 'quote', 'list', 'image', 'callout', 'divider'].map(type => [type, LayoutStyleSchema.optional()]))).strict(),
  nodes: z.array(nodeSchema).min(1).max(122),
}).strict();

const textOf = runs => (runs || []).map(run => run.text).join('');
export function layoutSource(article) {
  const content = [];
  if (article.title) content.push({ ref: 'title', type: 'title', text: article.title });
  if (article.summary) content.push({ ref: 'summary', type: 'summary', text: article.summary });
  for (const block of article.blocks) {
    const item = { ref: `block:${block.id}`, type: block.type === 'imageCard' ? 'image' : block.type };
    if (block.type === 'heading') Object.assign(item, { text: block.text, level: block.level });
    else if (block.type === 'list') Object.assign(item, { ordered: block.ordered, items: block.items.map(textOf) });
    else if (item.type === 'image') Object.assign(item, { assetId: block.assetId, title: block.title || '', caption: block.caption || '' });
    else if (block.type !== 'divider') Object.assign(item, { text: textOf(block.runs), ...(block.type === 'quote' ? { cite: block.cite || '' } : {}) });
    content.push(item);
  }
  return content;
}
export const layoutSignature = article => JSON.stringify(layoutSource(article));
export function clearArticleStyles(article) {
  const runs = values => values.map(run => ({ text: run.text }));
  return { ...article, blocks: article.blocks.map(block => {
    const { style, ...content } = block;
    if (block.runs) content.runs = runs(block.runs);
    if (block.items) content.items = block.items.map(runs);
    return content;
  }) };
}
export const layoutLeaves = nodes => nodes.flatMap(node => node.type === 'group' ? layoutLeaves(node.children) : [node]);
export function layoutContentStyle(design, item, node) {
  const defaults = { marginBottom: design.page.paragraphGap };
  if (item.type === 'title') Object.assign(defaults, { fontSize: 28, fontWeight: 800, lineHeight: 1.5, marginBottom: 24 });
  if (item.type === 'heading') Object.assign(defaults, { fontSize: item.level === 1 ? 22 : 18, fontWeight: 700, lineHeight: 1.6, marginTop: 28, marginBottom: 16 });
  return { ...defaults, ...design.rules[item.type], ...node.style };
}
export function contrastRatio(foreground, background) {
  const luminance = hex => {
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  };
  const a = luminance(foreground), b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function validateLayoutDesign(value, article) {
  const parsed = LayoutDesignSchema.safeParse(value);
  if (!parsed.success) throw new Error(`版式结构或样式超出约束：${parsed.error.issues.slice(0, 4).map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`);
  const design = parsed.data;
  const source = layoutSource(article);
  const leaves = layoutLeaves(design.nodes);
  if (JSON.stringify(leaves.map(node => node.ref)) !== JSON.stringify(source.map(item => item.ref))) throw new Error('必须按原顺序引用全部内容，每项恰好一次，不能遗漏、重复或新增内容');
  if (contrastRatio(design.page.color, design.page.backgroundColor) < 4.5) throw new Error('正文与页面背景的对比度必须至少为 4.5');
  const byRef = new Map(source.map(item => [item.ref, item]));
  let count = 0;
  const visit = (nodes, inherited, inset) => {
    for (const node of nodes) {
      if (++count > 180) throw new Error('布局节点过多，请减少分组');
      const item = byRef.get(node.ref);
      const style = item ? layoutContentStyle(design, item, node) : node.style || {};
      const resolved = { ...inherited, ...style };
      const nextInset = inset + (style.paddingX || 0) * 2 + (style.borderSide === 'all' ? 2 : style.borderSide === 'left' ? 1 : 0) * (style.borderWidth || 1);
      if (nextInset > 88) throw new Error('嵌套内边距过大，320px 下正文可用宽度至少应为 232px');
      if (node.type === 'group') visit(node.children, resolved, nextInset);
      else {
        if (item.type !== 'divider' && contrastRatio(resolved.color, resolved.backgroundColor) < 4.5) throw new Error(`${item.ref} 文字与背景的对比度不足 4.5`);
        if (item.type === 'title' && resolved.fontSize < 22) throw new Error('主标题字号至少22px，以保持清晰层级');
        if (item.type === 'heading' && (resolved.fontSize < 18 || resolved.fontSize > 28)) throw new Error('章节标题字号须为18–28px');
        if (['paragraph', 'quote', 'list', 'callout'].includes(item.type) && (resolved.fontSize < 15 || resolved.fontSize > 18 || resolved.lineHeight < 1.7)) throw new Error(`${item.ref} 正文字号须为15–18px，行距至少1.7`);
        const strings = [item.text, ...(item.items || []), item.title, item.caption, item.cite].filter(Boolean);
        if ((node.emphasis || []).some(text => !strings.some(part => part.includes(text)))) throw new Error(`${item.ref} 的重点必须是该内容中的连续原文`);
        if ((node.emphasis || []).reduce((sum, text) => sum + text.length, 0) > Math.max(30, strings.join('').length * 0.4)) throw new Error(`${item.ref} 重点过多，请控制强调密度`);
      }
    }
  };
  visit(design.nodes, design.page, design.page.paddingX * 2);
  return design;
}

export function reconcileLayout(design, article) {
  const source = layoutSource(article);
  const leaves = layoutLeaves(design.nodes);
  if (JSON.stringify(leaves.map(node => node.ref)) === JSON.stringify(source.map(item => item.ref))) return design.nodes;
  const sourceByRef = new Map(source.map(item => [item.ref, item]));
  const byRef = new Map();
  const appearance = ['color', 'backgroundColor', 'fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'textAlign'];
  const visit = (nodes, inherited) => {
    for (const node of nodes) {
      if (node.type === 'group') visit(node.children, { ...inherited, ...Object.fromEntries(Object.entries(node.style || {}).filter(([key]) => appearance.includes(key))) });
      else if (sourceByRef.has(node.ref)) byRef.set(node.ref, { ...node, style: { ...inherited, ...layoutContentStyle(design, sourceByRef.get(node.ref), node) } });
    }
  };
  visit(design.nodes, {});
  return source.map(item => byRef.get(item.ref) || { type: 'content', ref: item.ref });
}
