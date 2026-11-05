import { BlockStyleSchema, uid } from './core.js';

export const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const palette = { red: '#dc2626', orange: '#ea580c', green: '#16a34a' };
const blockTags = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL', 'FIGURE', 'HR', 'SECTION', 'ARTICLE']);
const ignoredTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'BUTTON', 'INPUT', 'SELECT']);

export function resolveColor(value, template) {
  return /^#[0-9a-f]{6}$/i.test(value || '') ? value : template.tokens[value] || palette[value] || template.tokens.text;
}

function color(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(value || '')) return '#' + value.slice(1).split('').map(c => c + c).join('');
  const rgb = value?.match(/^rgba?\(\s*(\d+)\D+(\d+)\D+(\d+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/);
  if (rgb && (rgb[4] === undefined || Number(rgb[4]) > 0)) return '#' + rgb.slice(1, 4).map(n => Math.max(0, Math.min(255, Number(n))).toString(16).padStart(2, '0')).join('');
  return { red: '#ff0000', yellow: '#ffff00', green: '#008000', blue: '#0000ff', black: '#000000', white: '#ffffff' }[value?.toLowerCase()];
}

function runHtml(runs = [], template) {
  return runs.map(run => {
    const css = `${run.bold !== undefined ? `font-weight:${run.bold ? 700 : 400};` : ''}${run.underline !== undefined ? `text-decoration:${run.underline ? 'underline' : 'none'};` : ''}${run.color ? `color:${resolveColor(run.color, template)};` : ''}${run.highlight ? `background-color:${color(run.highlight) || '#fff2a8'};` : ''}`;
    const token = ['primary', 'accent', 'red', 'orange', 'green'].includes(run.color) ? ` data-run-color="${run.color}"` : '';
    return css ? `<span style="${css}"${token}>${escapeHtml(run.text).replace(/\n/g, '<br>')}</span>` : escapeHtml(run.text).replace(/\n/g, '<br>');
  }).join('') || '<br>';
}

export function editorHtml(blocks, assets, template) {
  return blocks.map(block => {
    const style = BlockStyleSchema.safeParse(block.style || {}).data || {};
    const css = `${style.fontSize ? `font-size:${style.fontSize}px;` : ''}${style.align ? `text-align:${style.align};` : ''}${style.lineHeight ? `line-height:${style.lineHeight};` : ''}${style.paragraphSpacing !== undefined ? `margin-bottom:${style.paragraphSpacing}px;` : ''}${style.indent !== undefined ? `text-indent:${style.indent}em;` : ''}`;
    const attrs = `data-block-id="${escapeHtml(block.id)}" data-block-type="${block.type}" data-editor-key="block:${escapeHtml(block.id)}" data-block-style="${escapeHtml(JSON.stringify(style))}" style="${css}"`;
    if (block.type === 'heading') {
      const tag = block.level === 1 ? 'h2' : 'h3';
      return `<${tag} ${attrs}>${runHtml(block.runs || [{ text: block.text }], template)}</${tag}>`;
    }
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag} ${attrs}>${block.items.map(item => `<li>${runHtml(item, template)}</li>`).join('')}</${tag}>`;
    }
    if (block.type === 'quote') return `<blockquote ${attrs}><p data-quote-text>${runHtml(block.runs, template)}</p><cite data-cite contenteditable="true" data-placeholder="引文出处（可选）">${escapeHtml(block.cite || '')}</cite></blockquote>`;
    if (block.type === 'divider') return `<hr ${attrs} contenteditable="false">`;
    if (block.type === 'image' || block.type === 'imageCard') {
      const asset = assets.get(block.assetId);
      const url = asset?.previewUrl || asset?.url;
      const safeUrl = typeof url === 'string' && /^(https?:\/\/|blob:|data:image\/(?:png|jpeg|webp);base64,|\/uploads\/)/i.test(url) ? url : '';
      const placement = `width:${style.imageWidth || 100}%;margin-left:${['right', 'center'].includes(style.align) ? 'auto' : '0'};margin-right:${style.align === 'right' ? '0' : 'auto'};`;
      return `<figure ${attrs.replace(`style="${css}"`, `style="${placement}"`)} data-asset-id="${escapeHtml(block.assetId)}" data-image-align="${style.align || 'left'}" contenteditable="false" tabindex="0" draggable="true">${safeUrl ? `<img src="${escapeHtml(safeUrl)}" alt="${escapeHtml(block.caption || '文章图片')}" draggable="false">` : '<span class="editor-image-missing">图片待补充</span>'}<figcaption contenteditable="true" data-placeholder="点击填写图片说明">${escapeHtml(block.caption || '')}</figcaption><span class="editor-image-resize" data-resize-handle title="拖动调整图片宽度"></span></figure>`;
    }
    return `<p ${attrs}>${runHtml(block.runs, template)}</p>`;
  }).join('');
}

function readRuns(node, inherited = {}) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ? [{ ...inherited, text: node.textContent }] : [];
  if (node.nodeType !== Node.ELEMENT_NODE || ignoredTags.has(node.tagName) || node.hasAttribute('data-cite') || node.hasAttribute('data-resize-handle')) return [];
  if (node.tagName === 'BR') return [{ ...inherited, text: '\n' }];
  const format = { ...inherited };
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
  return Array.from(node.childNodes).flatMap(child => readRuns(child, format));
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

export function readEditorBlocks(root, previous = [], assets = new Map()) {
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
      node.dataset.editorKey = `block:${id}`;
    }
    result.push({ id, type, ...(style && Object.keys(style).length ? { style } : {}), ...fields });
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
        const runs = compactRuns(readRuns(node));
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
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const nodes = Array.from(root.querySelectorAll('[data-block-id]'));
  const endpoint = (container, offset, end) => {
    const direct = blockElement(root, container);
    if (direct) return direct;
    const child = container.childNodes[end ? Math.max(0, offset - 1) : offset];
    const adjacent = blockElement(root, child);
    if (adjacent) return adjacent;
    const candidates = nodes.filter(node => child?.contains?.(node));
    return end ? candidates.at(-1) || nodes.at(-1) : candidates[0] || nodes[0];
  };
  const first = endpoint(range.startContainer, range.startOffset, false);
  const last = endpoint(range.endContainer, range.endOffset, true);
  if (!first || !last) return null;
  const offset = (element, container, end) => {
    const prefix = range.cloneRange();
    prefix.selectNodeContents(element);
    prefix.setEnd(container, end);
    return prefix.toString().length;
  };
  return { startId: first.dataset.blockId, endId: last.dataset.blockId, startOffset: offset(first, range.startContainer, range.startOffset), endOffset: offset(last, range.endContainer, range.endOffset), ids: nodes.slice(nodes.indexOf(first), nodes.indexOf(last) + 1).map(node => node.dataset.blockId), text: range.toString(), collapsed: range.collapsed };
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
  const first = root.querySelector(`[data-block-id="${CSS.escape(bookmark.startId)}"]`);
  const last = root.querySelector(`[data-block-id="${CSS.escape(bookmark.endId)}"]`);
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(...textPoint(first, bookmark.startOffset));
  range.setEnd(...textPoint(last, bookmark.endOffset));
  return range;
}

export function restoreBookmark(root, bookmark) {
  const range = bookmarkRange(root, bookmark);
  if (!range) return false;
  root.focus({ preventScroll: true });
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  return true;
}

export function clipboardBlocks(html, text, assets) {
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script,style,iframe,object').forEach(node => node.remove());
    const blocks = readEditorBlocks(doc.body, [], assets);
    if (blocks.some(block => block.type !== 'paragraph' || block.runs.some(run => run.text))) return blocks;
  }
  return text.replace(/\r\n?/g, '\n').split('\n').map(line => ({ id: uid('b'), type: 'paragraph', runs: [{ text: line }] }));
}
