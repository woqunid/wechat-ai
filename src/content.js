import { BlockSchema, uid } from './core.js';

const clean = value => typeof value === 'string' ? value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '') : '';
const unstyle = text => clean(text).replace(/\*\*([^*\n]+)\*\*|__([^_\n]+)__/g, '$1$2').replace(/`([^`\n]+)`/g, '$1');
const make = (type, value = {}) => ({ id: uid('b'), type, ...value });

function inline(text, bold = false) {
  const runs = [];
  const pattern = /\*\*([^*\n]+)\*\*|__([^_\n]+)__/g;
  let offset = 0;
  for (const match of clean(text).matchAll(pattern)) {
    if (match.index > offset) runs.push({ text: text.slice(offset, match.index), ...(bold ? { bold: true } : {}) });
    runs.push({ text: match[1] || match[2], bold: true });
    offset = match.index + match[0].length;
  }
  if (offset < text.length) runs.push({ text: text.slice(offset), ...(bold ? { bold: true } : {}) });
  return runs.filter(run => run.text);
}

function normalizeRuns(value) {
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(run => {
    if (typeof run === 'string') return inline(clean(run));
    if (!run || typeof run !== 'object' || typeof run.text !== 'string') throw new Error('正文须使用 text 字符串或 runs 数组');
    return inline(clean(run.text), run.bold === true);
  }).flatMap(run => {
    const chunks = [];
    let start = 0;
    while (start < run.text.length) {
      let end = Math.min(start + 1200, run.text.length);
      if (end < run.text.length && /[\uD800-\uDBFF]/.test(run.text[end - 1])) end--;
      chunks.push({ ...run, text: run.text.slice(start, end) });
      start = end;
    }
    return chunks;
  });
}

function sliceRuns(runs, start, end) {
  const result = [];
  let offset = 0;
  for (const run of runs) {
    const from = Math.max(0, start - offset);
    const to = Math.min(run.text.length, end - offset);
    if (from < to) result.push({ ...run, text: run.text.slice(from, to) });
    offset += run.text.length;
    if (offset >= end) break;
  }
  return result;
}

function paragraphs(runs) {
  const text = runs.map(run => run.text).join('');
  const result = [];
  let start = 0;
  while (start < text.length) {
    const remaining = text.slice(start);
    const blank = remaining.search(/\n\s*\n/);
    let end = blank >= 0 ? start + blank : text.length;
    if (end - start > 280) {
      const sentence = text.slice(start + 120, Math.min(end, start + 280)).match(/[。！？；.!?](?:[”’」』])?(?:\s|$)?/);
      if (sentence) end = start + 120 + sentence.index + sentence[0].length;
      else if (end - start > 1200) {
        end = start + 1200;
        if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      }
    }
    const part = sliceRuns(runs, start, end);
    if (part.some(run => run.text.trim())) result.push(make('paragraph', { runs: part }));
    start = end;
    const separator = text.slice(start).match(/^\n\s*\n/);
    if (separator) start += separator[0].length;
  }
  return result;
}

function heading(text, level) {
  if (typeof text !== 'string') throw new Error('标题内容须为 text 字符串');
  const value = unstyle(text).replace(/^#{1,6}\s+/, '').trim();
  if (!value) return [];
  if (value.length > 40) return paragraphs([{ text: value }]);
  return [make('heading', { level, text: value })];
}

export function markdownBlocks(source) {
  const lines = clean(source).replace(/^```(?:markdown|md|text)?\s*\n([\s\S]*?)\n```$/i, '$1').split('\n');
  const blocks = [];
  let pending = [];
  let list = null;
  const flushParagraph = () => {
    if (pending.length) blocks.push(...paragraphs(inline(pending.join('\n'))));
    pending = [];
  };
  const flushList = () => {
    if (list) {
      for (let i = 0; i < list.items.length; i += 30) blocks.push(make('list', { ordered: list.ordered, items: list.items.slice(i, i + 30) }));
    }
    list = null;
  };
  for (const line of lines) {
    const value = line.trim();
    const title = value.match(/^(#{1,6})\s+(.+)$/);
    const item = value.match(/^(?:([-*+•])|\d+[.)、])\s+(.+)$/);
    if (!value) { flushParagraph(); flushList(); continue; }
    if (title) {
      flushParagraph(); flushList();
      blocks.push(...heading(title[2], title[1].length));
    } else if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(value)) {
      flushParagraph(); flushList(); blocks.push(make('divider'));
    } else if (/^>\s?/.test(value)) {
      flushParagraph(); flushList();
      const runs = inline(value.replace(/^>\s?/, ''));
      if (runs.length) blocks.push(make('quote', { runs }));
    } else if (item) {
      flushParagraph();
      const ordered = !item[1];
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push(inline(item[2]));
    } else {
      flushList(); pending.push(line);
    }
  }
  flushParagraph(); flushList();
  return blocks;
}

function normalizeBlock(block) {
  if (typeof block === 'string') return markdownBlocks(block);
  if (!block || typeof block !== 'object') throw new Error('内容块必须为对象');
  if (block.type === 'heading') {
    const level = Number(block.level);
    return heading(block.text, Number.isInteger(level) && level >= 1 && level <= 6 ? level : 1);
  }
  if (['paragraph', 'callout', 'quote'].includes(block.type)) {
    const runs = normalizeRuns(block.runs ?? block.text ?? block.content ?? '');
    if (!runs.length || !runs.some(run => run.text.trim())) return [];
    if (block.type === 'paragraph') {
      const text = runs.map(run => run.text).join('');
      if (/(?:^|\n)(?:#{1,6}\s|>\s|[-*+]\s|\d+\.\s|---\s*$)/m.test(text)) {
        const markdown = runs.map(run => run.bold ? `**${run.text}**` : run.text).join('');
        return markdownBlocks(markdown);
      }
      return paragraphs(runs);
    }
    if (block.cite != null && typeof block.cite !== 'string') throw new Error('引文出处须为字符串');
    return [make(block.type, { runs, ...(block.type === 'quote' && block.cite ? { cite: unstyle(block.cite) } : {}) })];
  }
  if (block.type === 'list') {
    if (!Array.isArray(block.items)) throw new Error('清单须使用 items 数组');
    const items = block.items.map(item => normalizeRuns(Array.isArray(item) || typeof item === 'string' ? item : item?.runs ?? item?.text ?? '')).filter(runs => runs.some(run => run.text.trim()));
    const result = [];
    for (let i = 0; i < items.length; i += 30) result.push(make('list', { ordered: block.ordered === true, items: items.slice(i, i + 30) }));
    return result;
  }
  if (block.type === 'image' || block.type === 'imageCard') return [make(block.type, { assetId: block.assetId, ...(block.title ? { title: unstyle(block.title) } : {}), ...(block.caption ? { caption: unstyle(block.caption) } : {}) })];
  if (block.type === 'divider') return [make('divider')];
  throw new Error(`不支持的内容块：${String(block.type)}；请使用规定的八种类型`);
}

export function normalizeDraft(raw, assetIds = []) {
  let draft;
  if (typeof raw === 'string') {
    const value = clean(raw).trim().replace(/^```(?:json|markdown|md|text)?[ \t]*\n([\s\S]*?)\n?```$/i, '$1').trim();
    try { draft = JSON.parse(value); }
    catch {
      if (/^[{[]/.test(value)) throw new Error('JSON 不完整，请返回完整 JSON 对象');
      draft = { content: value };
    }
  } else draft = raw;
  if (!draft || typeof draft !== 'object' || Array.isArray(draft)) throw new Error('须返回 title、summary、blocks 对象');
  if (draft.title != null && typeof draft.title !== 'string') throw new Error('title 须为字符串');
  if (draft.summary != null && typeof draft.summary !== 'string') throw new Error('summary 须为字符串');
  let title = unstyle(draft.title || '').replace(/^#{1,6}\s+/, '').trim();
  const summary = unstyle(draft.summary || '').trim();
  let blocks;
  if (Array.isArray(draft.blocks)) blocks = draft.blocks.flatMap(normalizeBlock);
  else if (typeof draft.content === 'string' || typeof draft.body === 'string') blocks = markdownBlocks(draft.content ?? draft.body);
  else throw new Error('缺少 blocks 数组');
  if (blocks[0]?.type === 'heading' && (!title || blocks[0].text === title)) {
    title ||= blocks[0].text;
    blocks.shift();
  }
  if (title.length > 64 || summary.length > 120) throw new Error('标题须不超过 64 字，摘要须不超过 120 字');
  const headingLevels = blocks.filter(block => block.type === 'heading').map(block => block.level);
  const primaryLevel = Math.min(...headingLevels);
  blocks = blocks.map(block => block.type === 'heading' ? { ...block, level: block.level === primaryLevel ? 1 : 2 } : block);
  const used = new Set();
  blocks = blocks.map(block => {
    if (block.type === 'image' || block.type === 'imageCard') {
      if (!assetIds.includes(block.assetId) || used.has(block.assetId)) throw new Error('图片必须引用提供的 assetId，且不可重复');
      used.add(block.assetId);
    }
    const parsed = BlockSchema.safeParse(block);
    if (!parsed.success) throw new Error(`内容块 ${block.type} 不符合格式：${parsed.error.issues[0]?.path.join('.')}`);
    return parsed.data;
  });
  if (!blocks.some(block => !['divider', 'image', 'imageCard', 'heading'].includes(block.type))) throw new Error('正文不能为空');
  if (blocks.length + assetIds.filter(id => !used.has(id)).length > 120) throw new Error('内容块不得超过 120 个');
  return { title, summary, blocks };
}
