import { articleField, BlockStyleSchema, blockText, uid } from './core.js';
import { renderArticle } from './renderer.js';

export const editorKey = id => id === '$title' || id === '$summary' ? id.slice(1) : `block:${id}`;
export const editorBlocks = article => [articleField(article, 'title'), articleField(article, 'summary'), ...article.blocks];
export function editorContent(blocks) {
  const fields = {};
  for (const field of ['title', 'summary']) {
    const block = blocks.find(block => block.field === field);
    fields[field] = block ? blockText(block) : '';
    fields[`${field}Format`] = block ? { ...(block.style ? { style: block.style } : {}), runs: block.runs || [{ text: fields[field] }] } : undefined;
  }
  return { ...fields, blocks: blocks.filter(block => !block.field) };
}

const blockTags = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'HR', 'SECTION', 'ARTICLE']);
const ignoredTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT', 'SELECT']);

function color(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value || '')) return '#' + value.slice(1).split('').map(c => c + c).join('');
  const rgb = value?.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) return '#' + rgb.slice(1, 4).map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
  return { red: '#ff0000', yellow: '#ffff00', green: '#008000', blue: '#0000ff', black: '#000000', white: '#ffffff' }[value?.toLowerCase()];
}

export const editorHtml = (article, assets, template) => renderArticle(article, template, assets, { mode: 'preview', editing: true }).html;

const partsOf = node => [ ...(node.matches('[data-editor-part]') ? [node] : []), ...node.querySelectorAll('[data-editor-part]') ];
const partKey = node => node.dataset.editorPart === 'item' ? `item:${node.dataset.editorIndex}` : node.dataset.editorPart;
const partElement = (root, id, part = 'runs') => {
  const node = root.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
  return node && partsOf(node).find(node => partKey(node) === part);
};
export function prepareEditor(root, blocks, readOnly = false) {
  const byKey = new Map(blocks.map(block => [editorKey(block.id), block]));
  for (const node of root.querySelectorAll('[data-preview-key]')) {
    const block = byKey.get(node.dataset.previewKey);
    if (!block) continue;
    node.dataset.blockId = block.id;
    node.dataset.blockType = block.type;
    node.dataset.editorKey = editorKey(block.id);
    if (block.type === 'image' || block.type === 'imageCard' || block.type === 'divider') {
      node.tabIndex = 0;
      if (block.type !== 'divider') {
        node.classList.add('editor-image');
        node.draggable = !readOnly;
        node.dataset.imageAlign = block.style?.align || 'left';
        if (!readOnly) {
          const handle = root.ownerDocument.createElement('span');
          handle.className = 'editor-image-resize';
          handle.dataset.resizeHandle = '';
          handle.contentEditable = 'false';
          handle.title = '拖动调整图片宽度';
          node.appendChild(handle);
        }
      }
    }
    for (const part of partsOf(node)) {
      part.contentEditable = String(!readOnly);
      part.spellcheck = false;
      part.dataset.placeholder = block.field === 'title' ? '输入文章标题' : block.field === 'summary' ? '添加摘要（可选）' : ({ cite: '引文出处（可选）', caption: '点击填写图片说明' })[part.dataset.editorPart] || '输入正文';
      if (!part.textContent) part.innerHTML = '<br>';
    }
  }
}

export function readRenderedBlocks(root, previous) {
  return previous.map(block => {
    const node = root.querySelector(`[data-block-id="${CSS.escape(block.id)}"]`);
    if (!node) return block;
    const next = { ...block };
    for (const part of partsOf(node)) {
      const copy = part.cloneNode(true);
      let tail = copy;
      while (tail.lastChild) tail = tail.lastChild;
      // Browsers keep a trailing BR as a caret placeholder in an empty editing host.
      if (tail.nodeName === 'BR') tail.remove();
      const runs = compactRuns(Array.from(copy.childNodes).flatMap(child => readRuns(child, {}, true)));
      const text = runs.map(run => run.text).join('');
      const name = part.dataset.editorPart;
      if (name === 'item') next.items = (next.items || []).map((item, index) => index === Number(part.dataset.editorIndex) ? runs : item);
      else if (name === 'runs') {
        next.runs = runs;
        if (block.type === 'heading') next.text = text;
      } else next[name] = text;
    }
    return next;
  });
}

function readRuns(node, inherited = {}, rendered = false) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ ...inherited, text: node.textContent }] : [];
  if (node.nodeType !== Node.ELEMENT_NODE || ignoredTags.has(node.tagName) || node.hasAttribute('data-cite') || node.hasAttribute('data-resize-handle')) return [];
  if (node.tagName === 'BR') return [{ ...inherited, text: '\n' }];
  const format = { ...inherited };
  if (rendered && node.dataset.runFormat) {
    try { const { text, ...stored } = JSON.parse(node.dataset.runFormat); Object.assign(format, stored); } catch { /* Invalid editor metadata is ignored. */ }
    return Array.from(node.childNodes).flatMap(child => readRuns(child, format, true));
  }
  if (node.style.fontWeight === 'normal' || (Number(node.style.fontWeight) > 0 && Number(node.style.fontWeight) < 600)) format.bold = false;
  if (['B', 'STRONG'].includes(node.tagName) || Number(node.style.fontWeight) >= 600 || node.style.fontWeight === 'bold') format.bold = true;
  const decoration = node.style.textDecorationLine || node.style.textDecoration;
  if (decoration === 'none') format.underline = false;
  if (node.tagName === 'U' || decoration.includes('underline')) format.underline = true;
  const foreground = color(node.style.color || node.getAttribute('color'));
  if (foreground) format.color = ['primary','accent','red','orange','green'].includes(node.dataset.runColor) ? node.dataset.runColor : foreground;
  const background = color(node.style.backgroundColor);
  if (background) format.highlight = background;
  else if (node.style.backgroundColor) delete format.highlight;
  return Array.from(node.childNodes).flatMap(child => readRuns(child, format, rendered));
}

function compactRuns(runs) {
  const result = [];
  for (const run of runs) {
    if (!run.text) continue;
    const previous = result.at(-1);
    if (previous && ['bold', 'underline', 'color', 'highlight'].every(key => previous[key] === run[key]) && previous.text.length + run.text.length <= 1200) previous.text += run.text;
    else {
      let offset = 0;
      while (offset < run.text.length) {
        let end = Math.min(offset + 1200, run.text.length);
        if (end < run.text.length && /[\uD800-\uDBFF]/.test(run.text[end - 1])) end--;
        result.push({ ...run, text: run.text.slice(offset, end) });
        offset = end;
      }
    }
  }
  return result.length ? result : [{ text: '' }];
}

function readClipboardBlocks(root, previous = [], assets = new Map()) {
  const originals = new Map(previous.map(block => [block.id, block]));
  const seen = new Set();
  const result = [];
  const push = (node, type, fields) => {
    let id = node.dataset?.blockId;
    if (!id || seen.has(id) || !originals.has(id)) id = uid('b');
    seen.add(id);
    const old = originals.get(id);
    let style = old?.style;
    if (!style && node.dataset?.blockStyle) {
      try { style = BlockStyleSchema.safeParse(JSON.parse(node.dataset.blockStyle)).data; } catch { /* Ignore pasted attributes outside the editor format. */ }
    }
    if (node.dataset) {
      node.dataset.blockId = id;
      node.dataset.blockType = type;
      node.dataset.editorKey = editorKey(id);
    }
    result.push({ id, type, ...(old?.field ? { field: old.field } : {}), ...(style && Object.keys(style).length ? { style } : {}), ...fields });
  };
  const visit = parent => {
    let inlineNodes = [];
    const flush = () => {
      if (inlineNodes.length) {
        const wrapper = root.ownerDocument.createElement('p');
        parent.insertBefore(wrapper, inlineNodes[0]);
        inlineNodes.forEach(node => wrapper.appendChild(node));
        push(wrapper, 'paragraph', { runs: compactRuns(readRuns(wrapper)) });
        inlineNodes = [];
      }
    };
    for (const node of Array.from(parent.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;
      if (node.nodeType !== Node.ELEMENT_NODE || !blockTags.has(node.tagName)) {
        if (node.nodeType === Node.ELEMENT_NODE && ignoredTags.has(node.tagName)) continue;
        inlineNodes.push(node); continue;
      }
      flush();
      if (['SECTION', 'ARTICLE', 'DIV'].includes(node.tagName) && Array.from(node.children).some(child => blockTags.has(child.tagName))) {
        delete node.dataset.blockId; delete node.dataset.editorKey;
        visit(node); continue;
      }
      if (node.tagName === 'FIGURE') {
        const assetId = node.dataset.assetId;
        if (!assets.has(assetId)) continue;
        const old = originals.get(node.dataset.blockId);
        push(node, old?.type === 'image' ? 'image' : 'imageCard', { assetId, ...(old?.title ? { title: old.title } : {}), caption: node.querySelector('figcaption')?.textContent || '' });
      } else if (node.tagName === 'HR') push(node, 'divider', {});
      else if (/^H[1-6]$/.test(node.tagName)) {
        const empty = node.childNodes.length === 1 && node.firstChild.nodeName === 'BR';
        const runs = empty ? [{ text: '' }] : compactRuns(readRuns(node));
        push(node, 'heading', { level: ['H1', 'H2'].includes(node.tagName) ? 1 : 2, text: runs.map(run => run.text).join(''), runs });
      } else if (node.tagName === 'UL' || node.tagName === 'OL') {
        const items = Array.from(node.children).filter(child => child.tagName === 'LI').map(child => compactRuns(readRuns(child)));
        if (items.length) push(node, 'list', { ordered: node.tagName === 'OL', items });
      } else if (node.tagName === 'BLOCKQUOTE') {
        const content = node.querySelector('[data-quote-text]') || node;
        push(node, 'quote', { runs: compactRuns(Array.from(content.childNodes).flatMap(child => readRuns(child))), cite: node.querySelector('cite')?.textContent || '' });
      } else {
        const type = node.dataset.blockType === 'callout' ? 'callout' : 'paragraph';
        const empty = node.childNodes.length === 1 && node.firstChild.nodeName === 'BR';
        push(node, type, { runs: empty ? [{ text: '' }] : compactRuns(readRuns(node)) });
      }
    }
    flush();
  };
  visit(root);
  return result.length ? result : [{ id: uid('b'), type: 'paragraph', runs: [{ text: '' }] }];
}

const blockElement = (root, node) => {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  const block = element?.closest('[data-block-id]');
  return block && root.contains(block) ? block : null;
};

export function editorBookmark(root) {
  const selection = window.getSelection();
  if (!selection?.rangeCount || !root) return null;
  const range = selection.getRangeAt(0);
  const element = node => node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
  const firstPart = element(range.startContainer)?.closest('[data-editor-part]');
  const lastPart = element(range.endContainer)?.closest('[data-editor-part]');
  if (!firstPart || !lastPart || !root.contains(firstPart) || !root.contains(lastPart)) return null;
  const first = blockElement(root, firstPart), last = blockElement(root, lastPart);
  const nodes = Array.from(root.querySelectorAll('[data-block-id]'));
  const offset = (part, container, end) => {
    const prefix = range.cloneRange();
    prefix.selectNodeContents(part);
    prefix.setEnd(container, end);
    return prefix.toString().length;
  };
  const startOffset = offset(firstPart, range.startContainer, range.startOffset);
  const endOffset = offset(lastPart, range.endContainer, range.endOffset);
  const parts = Array.from(root.querySelectorAll('[data-editor-part]'));
  const selected = parts.slice(parts.indexOf(firstPart), parts.indexOf(lastPart) + 1);
  const text = selected.map((part, i) => part.textContent.slice(i ? 0 : startOffset, i === selected.length - 1 ? endOffset : undefined)).join('\n');
  return { startId: first.dataset.blockId, endId: last.dataset.blockId, startPart: partKey(firstPart), endPart: partKey(lastPart), startOffset, endOffset, ids: nodes.slice(nodes.indexOf(first), nodes.indexOf(last) + 1).map(node => node.dataset.blockId), text, collapsed: range.collapsed };
}

function textPoint(element, offset) {
  const walker = element.ownerDocument.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let remaining = offset;
  let last;
  while (walker.nextNode()) {
    last = walker.currentNode;
    if (remaining <= last.textContent.length) return [last, remaining];
    remaining -= last.textContent.length;
  }
  return last ? [last, last.textContent.length] : [element, 0];
}

export function bookmarkRange(root, bookmark) {
  if (!root || !bookmark) return null;
  const first = partElement(root, bookmark.startId, bookmark.startPart);
  const last = partElement(root, bookmark.endId, bookmark.endPart);
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(...textPoint(first, bookmark.startOffset));
  range.setEnd(...textPoint(last, bookmark.endOffset));
  return range;
}

export function restoreBookmark(root, bookmark) {
  const range = bookmarkRange(root, bookmark);
  if (!range) return false;
  const part = partElement(root, bookmark.startId, bookmark.startPart);
  part?.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function editorSelectionHtml(root, bookmark) {
  const parts = [...root.querySelectorAll('[data-editor-part]')];
  const first = partElement(root, bookmark.startId, bookmark.startPart), last = partElement(root, bookmark.endId, bookmark.endPart);
  return parts.slice(parts.indexOf(first), parts.indexOf(last) + 1).map(part => {
    const range = root.ownerDocument.createRange();
    range.setStart(...textPoint(part, part === first ? bookmark.startOffset : 0));
    range.setEnd(...textPoint(part, part === last ? bookmark.endOffset : part.textContent.length));
    const paragraph = root.ownerDocument.createElement('p');
    const style = getComputedStyle(part);
    for (const property of ['font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'color', 'text-align', 'white-space']) paragraph.style.setProperty(property, style.getPropertyValue(property));
    paragraph.appendChild(range.cloneContents());
    for (const node of paragraph.querySelectorAll('*')) for (const attribute of [...node.attributes]) if (attribute.name !== 'style') node.removeAttribute(attribute.name);
    return paragraph.outerHTML;
  }).join('');
}

export const editorParts = block => block.type === 'list' ? block.items.map((_, index) => `item:${index}`)
  : block.type === 'image' || block.type === 'imageCard' ? [...(block.title ? ['title'] : []), 'caption']
  : block.type === 'divider' ? [] : ['runs', ...(block.type === 'quote' ? ['cite'] : [])];
export const partRuns = (block, part = 'runs') => part.startsWith('item:') ? block.items[Number(part.slice(5))]
  : part === 'runs' ? block.runs || [{ text: block.text || '' }] : [{ text: block[part] || '' }];
export function withPartRuns(block, part = 'runs', runs) {
  runs = compactRuns(runs);
  if (part.startsWith('item:')) return { ...block, items: block.items.map((item, index) => index === Number(part.slice(5)) ? runs : item) };
  if (part !== 'runs') return { ...block, [part]: runs.map(run => run.text).join('') };
  return { ...block, runs, ...(block.type === 'heading' ? { text: runs.map(run => run.text).join('') } : {}) };
}
export function sliceRuns(runs, start = 0, end = Infinity) {
  let offset = 0;
  return runs.flatMap(run => {
    const from = Math.max(0, start - offset), to = Math.min(run.text.length, end - offset);
    offset += run.text.length;
    return to > from ? [{ ...run, text: run.text.slice(from, to) }] : [];
  });
}
export function formatEditorSelection(blocks, saved, patch) {
  if (!saved || saved.collapsed) return blocks;
  let inside = false;
  return blocks.map(block => {
    let next = block;
    for (const part of editorParts(block)) {
      const first = block.id === saved.startId && part === (saved.startPart || 'runs');
      const last = block.id === saved.endId && part === (saved.endPart || 'runs');
      if (first) inside = true;
      if (inside && (part === 'runs' || part.startsWith('item:'))) {
        const runs = partRuns(block, part), from = first ? saved.startOffset : 0, to = last ? saved.endOffset : Infinity;
        next = withPartRuns(next, part, [...sliceRuns(runs, 0, from), ...sliceRuns(runs, from, to).map(run => patch === null ? { text: run.text } : { ...run, ...patch }), ...sliceRuns(runs, to)]);
      }
      if (last) inside = false;
    }
    return next;
  });
}

export function replaceEditorSelection(blocks, saved, inserted = [{ text: '' }]) {
  if (!saved) return null;
  const first = blocks.find(block => block.id === saved.startId), last = blocks.find(block => block.id === saved.endId);
  if (!first || !last) return null;
  const startPart = saved.startPart || 'runs', endPart = saved.endPart || 'runs';
  const prefix = sliceRuns(partRuns(first, startPart), 0, saved.startOffset);
  const suffix = sliceRuns(partRuns(last, endPart), saved.endOffset);
  const plain = block => !block.field && ['paragraph', 'heading', 'callout'].includes(block.type);
  const join = first.id !== last.id && plain(first) && plain(last) && startPart === 'runs' && endPart === 'runs';
  let inside = false;
  const next = blocks.flatMap(block => {
    if (join && block.id === first.id) { inside = true; return [withPartRuns(block, startPart, [...prefix, ...inserted, ...suffix])]; }
    if (join && inside) { if (block.id === last.id) inside = false; return []; }
    let value = block;
    const wasInside = inside;
    for (const part of editorParts(block)) {
      const start = block.id === first.id && part === startPart, end = block.id === last.id && part === endPart;
      if (start) inside = true;
      if (inside) value = withPartRuns(value, part, [...(start ? [...prefix, ...inserted] : []), ...(end ? suffix : [])]);
      if (end) inside = false;
    }
    if (wasInside && inside && !block.field && block.id !== first.id && block.id !== last.id) return [];
    return [value];
  });
  const offset = saved.startOffset + inserted.reduce((length, run) => length + run.text.length, 0);
  return { blocks: next, bookmark: { startId: first.id, endId: first.id, startPart, endPart: startPart, startOffset: offset, endOffset: offset, ids: [first.id], collapsed: true, text: '' } };
}

export function clipboardBlocks(html, text, assets) {
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object').forEach(node => node.remove());
    const blocks = readClipboardBlocks(doc.body, [], assets);
    if (blocks.some(block => block.type !== 'paragraph' || block.runs.some(run => run.text))) return blocks;
  }
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => ({ id: uid('b'), type: 'paragraph', runs: [{ text: line }] }));
}
