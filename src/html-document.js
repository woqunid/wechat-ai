import { DomUtils, parseDocument } from 'htmlparser2';

export const MAX_HTML_LENGTH = 600_000;
const tags = new Set(['section', 'div', 'p', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'br', 'img', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'ul', 'ol', 'li', 'hr', 'a']);
const blocked = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math', 'link', 'meta', 'input', 'button', 'textarea', 'select', 'form']);
const css = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-family', 'font-style', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'text-decoration', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border', 'border-left', 'border-right', 'border-top', 'border-bottom', 'border-top-style', 'border-top-width', 'border-style', 'border-color', 'border-width', 'border-radius', 'width', 'max-width', 'height', 'display', 'box-sizing', 'vertical-align', 'word-break', 'white-space', 'overflow-wrap', 'list-style-type', 'list-style-position']);
const metadata = new Set(['data-node-id', 'data-preview-key', 'data-asset-id', 'data-editor-part', 'data-editor-index', 'data-decoration', 'data-block-type', 'data-heading-level', 'data-list-ordered']);
const validId = value => /^[\w:$.-]{1,80}$/.test(value || '');
export const htmlTree = html => parseDocument(html || '', { decodeEntities: true });
export const outerHtml = node => DomUtils.getOuterHTML(node, { encodeEntities: 'utf8' });
export const innerHtml = node => (node.children || []).map(outerHtml).join('');
export const nodeText = node => node.type === 'text' ? node.data : node.name === 'br' ? '\n' : node.name === 'img' ? '\uFFFC' : (node.children || []).map(nodeText).join('');
export function htmlElements(root) {
  const result = [];
  const visit = node => { if (node.type === 'tag') result.push(node); for (const child of node.children || []) visit(child); };
  visit(root);
  return result;
}
export const findHtmlNode = (html, id) => htmlElements(htmlTree(html)).find(node => node.attribs['data-node-id'] === id);
const allowedStyle = (key, value) => css.has(key) && Boolean(value) && !/[\\{}<>@]|url\s*\(|expression|javascript|var\s*\(|!important/i.test(value)
  && (key !== 'display' || ['block', 'inline', 'inline-block', 'list-item'].includes(value))
  && !(/^(margin|padding|width|height|font-size|line-height|text-indent)/.test(key) && /-\d/.test(value))
  && (key !== 'height' || value === 'auto')
  && (key !== 'white-space' || ['normal', 'pre-wrap', 'pre-line'].includes(value));
export const cssDeclarations = style => (style || '').split(';').flatMap(declaration => {
  const at = declaration.indexOf(':');
  return at < 0 ? [] : [[declaration.slice(0, at).trim().toLowerCase(), declaration.slice(at + 1).trim()]];
});
export const unsupportedStyles = html => [...new Set(htmlElements(htmlTree(html)).flatMap(node => cssDeclarations(node.attribs.style).filter(([key, value]) => value && !allowedStyle(key, value)).map(([key, value]) => `${key}:${value}`)))];
export const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

export function sanitizeHtml(html) {
  if (typeof html !== 'string' || html.length > MAX_HTML_LENGTH) throw new Error('文章 HTML 过长，请精简内容');
  let tree = htmlTree(html);
  const roots = tree.children.filter(node => node.type === 'tag' || node.type === 'text' && node.data.trim());
  if (roots.length > 1 || roots[0]?.type === 'text') tree = htmlTree(`<section>${html}</section>`);
  const used = new Set();
  const reserved = new Set(htmlElements(tree).map(node => node.attribs['data-node-id']));
  let serial = 0, count = 0;
  const clean = node => {
    if (node.type === 'text') return escapeHtml(node.data);
    if (node.type !== 'tag' || blocked.has(node.name)) return '';
    if (!tags.has(node.name)) return (node.children || []).map(clean).join('');
    if (++count > 5000) throw new Error('文章元素过多，请精简版式');
    const attrs = {};
    let id = node.attribs['data-node-id'];
    if (!validId(id) || used.has(id)) { do { id = `n_${++serial}`; } while (used.has(id) || reserved.has(id)); }
    attrs['data-node-id'] = id;
    used.add(id);
    for (const [key, value] of Object.entries(node.attribs)) {
      if (metadata.has(key) && key !== 'data-node-id' && value.length <= 100) attrs[key] = value;
      if (key === 'alt' || key === 'title') attrs[key] = value.slice(0, 500);
    }
    if (node.name === 'font') return (node.children || []).map(clean).join('');
    const declarations = cssDeclarations(node.attribs.style).filter(([key, value]) => allowedStyle(key, value)).map(([key, value]) => `${key}:${value}`);
    if (declarations.length) attrs.style = `${declarations.join(';')};`;
    if (node.name === 'a' && /^https:\/\/[^\s<>"']+$/i.test(node.attribs.href || '')) attrs.href = node.attribs.href;
    if (node.name === 'img') {
      if (!/^img_[\w-]{3,80}$/.test(attrs['data-asset-id'] || '')) throw new Error('图片必须使用图片库中已有的资源');
      attrs.style = `${declarations.filter(value => !/^(max-width|height):/.test(value)).join(';')}${declarations.length ? ';' : ''}max-width:100%;height:auto;`;
    }
    const open = `<${node.name}${Object.entries(attrs).map(([key, value]) => ` ${key}="${escapeHtml(value)}"`).join('')}>`;
    return open + (['br', 'img', 'hr'].includes(node.name) ? '' : (node.children || []).map(clean).join('') + `</${node.name}>`);
  };
  const result = tree.children.map(clean).join('');
  if (!result.trim()) throw new Error('文章至少保留一个可编辑区域');
  if (result.length > MAX_HTML_LENGTH) throw new Error('文章 HTML 过长，请精简内容');
  if (htmlElements(htmlTree(result)).filter(node => node.name === 'img').length > 10) throw new Error('正文最多添加10张图片');
  return result;
}

export function renderHtmlDocument(html, assets = new Map(), { mode = 'wechat', interactive = false } = {}) {
  const tree = htmlTree(sanitizeHtml(html));
  for (const node of htmlElements(tree)) {
    if (node.name === 'img' && mode !== 'source') {
      const asset = assets.get(node.attribs['data-asset-id']);
      const candidates = mode === 'preview' ? [asset?.previewUrl, asset?.cacheUrl, asset?.url] : [asset?.url];
      const url = candidates.find(value => typeof value === 'string' && (mode === 'preview' ? /^(https:\/\/|\/uploads\/|blob:|data:image\/(png|jpeg|webp);base64,)/i : /^https:\/\//i).test(value));
      if (asset?.pasteStatus === 'broken' && mode !== 'preview') { DomUtils.removeElement(node); continue; }
      if (url) node.attribs.src = url;
      else if (mode !== 'preview' || asset?.pasteStatus === 'broken') {
        DomUtils.replaceElement(node, htmlTree(`<p style="margin:0;padding:24px 10px;text-align:center;font-size:13px;">[图片待补充：${escapeHtml(node.attribs.alt || '文章图片')}]</p>`).children[0]);
        continue;
      }
    }
    for (const key of Object.keys(node.attribs)) if (key.startsWith('data-') && !interactive) delete node.attribs[key];
  }
  return innerHtml(tree);
}

export function htmlPlainText(html) {
  const read = node => node.type === 'text' ? node.data : node.name === 'br' ? '\n' : node.name === 'img' ? `[图片：${node.attribs.alt || '文章图片'}]` : (node.children || []).map(read).join('') + (['section', 'div', 'p', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'li'].includes(node.name) ? '\n' : '');
  return read(htmlTree(html)).replace(/\n{3,}/g, '\n\n').trim();
}

const runsOf = node => {
  const text = nodeText(node);
  const runs = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + 1200, text.length);
    if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
    runs.push({ text: text.slice(start, end) }); start = end;
  }
  return runs.length ? runs : [{ text: '' }];
};
export function articleWithHtml(article, html) {
  const safe = sanitizeHtml(html);
  const tree = htmlTree(safe);
  const elements = htmlElements(tree);
  const fields = { title: '', summary: '' };
  const blocks = [];
  let textSerial = 0;
  const semantic = new Set();
  for (const node of elements) {
    const key = node.attribs['data-preview-key'];
    if (key === 'title' || key === 'summary') {
      const parts = htmlElements(node).filter(item => item.attribs['data-editor-part'] === 'runs');
      const text = parts.length ? parts.map(nodeText).join('\n') : nodeText(node);
      let limit = key === 'title' ? 80 : 120;
      if (/[\uD800-\uDBFF]/.test(text[limit - 1] || '')) limit--;
      fields[key] = text.slice(0, limit);
      if (text.length > limit) blocks.push({ id: `overflow_${++textSerial}`, type: 'paragraph', runs: runsOf({ type: 'text', data: text.slice(limit) }) });
      semantic.add(node);
    }
  }
  const visit = node => {
    if (node.attribs?.['data-decoration']) return;
    if (semantic.has(node)) return;
    if (node.type === 'text') {
      if (node.data.trim()) blocks.push({ id: `text_${++textSerial}`, type: 'paragraph', runs: runsOf(node) });
      return;
    }
    if (node.type !== 'tag') { for (const child of node.children || []) visit(child); return; }
    const key = node.attribs['data-preview-key'];
    const parts = htmlElements(node).filter(item => item.attribs['data-editor-part']);
    const image = node.name === 'img' ? node : ['image', 'imageCard'].includes(node.attribs['data-block-type']) ? htmlElements(node).find(item => item.name === 'img') : null;
    const id = image ? image.attribs['data-node-id'] : node.attribs['data-node-id'];
    if (image) {
      const title = nodeText(parts.find(part => part.attribs['data-editor-part'] === 'title') || { children: [] });
      const caption = nodeText(parts.find(part => part.attribs['data-editor-part'] === 'caption') || { children: [] });
      blocks.push({ id, type: 'imageCard', assetId: image.attribs['data-asset-id'], ...(title ? { title: title.slice(0, 80) } : {}), caption: caption.slice(0, 300) });
      for (const remaining of [title.slice(80), caption.slice(300)].filter(Boolean)) blocks.push({ id: `overflow_${++textSerial}`, type: 'paragraph', runs: runsOf({ type: 'text', data: remaining }) });
    } else if (htmlElements(node).some(child => child.name === 'img') && (['p', 'h1', 'h2', 'h3', 'h4'].includes(node.name) || key?.startsWith('block:') && parts.length)) {
      const source = parts.find(part => part.attribs['data-editor-part'] === 'runs') || node;
      for (const child of source.children || []) visit(child);
    } else if (key?.startsWith('block:') && parts.length) {
      const items = parts.filter(part => part.attribs['data-editor-part'] === 'item');
      const source = parts.find(part => part.attribs['data-editor-part'] === 'runs') || node;
      if (items.length) blocks.push({ id, type: 'list', ordered: node.attribs['data-list-ordered'] !== 'false', items: items.map(runsOf) });
      else if (node.attribs['data-block-type'] === 'heading' && nodeText(source).length <= 120) blocks.push({ id, type: 'heading', level: node.attribs['data-heading-level'] === '1' ? 1 : 2, text: nodeText(source), runs: runsOf(source) });
      else if (node.attribs['data-block-type'] === 'quote') blocks.push({ id, type: 'quote', runs: runsOf(source), cite: nodeText(parts.find(part => part.attribs['data-editor-part'] === 'cite') || { children: [] }).slice(0, 120) });
      else blocks.push({ id, type: node.attribs['data-block-type'] === 'callout' ? 'callout' : 'paragraph', runs: runsOf(source) });
    } else if (node.attribs['data-block-type'] === 'divider') {
      blocks.push({ id, type: 'divider' });
    } else if (['ul', 'ol'].includes(node.name)) {
      const items = (node.children || []).filter(child => child.name === 'li');
      blocks.push({ id, type: 'list', ordered: node.name === 'ol', items: items.map(runsOf) });
    } else if (['p', 'h1', 'h2', 'h3', 'h4', 'blockquote'].includes(node.name) && !htmlElements(node).some(child => child !== node && child.name === 'img')) {
      blocks.push(/^h/.test(node.name) && nodeText(node).length <= 120 ? { id, type: 'heading', level: node.name === 'h1' ? 1 : 2, text: nodeText(node), runs: runsOf(node) } : { id, type: node.name === 'blockquote' ? 'quote' : 'paragraph', runs: runsOf(node) });
    } else if (node.name === 'hr') blocks.push({ id, type: 'divider' });
    else if (node.children?.length && !node.children.some(child => child.type === 'tag')) blocks.push({ id, type: 'paragraph', runs: runsOf(node) });
    else for (const child of node.children || []) visit(child);
  };
  visit(tree);
  const body = blocks.filter(block => block.type !== 'list' || block.items.length);
  if (body.length > 120 || body.some(block => block.items?.length > 30)) throw new Error('正文最多120段，每个列表最多30项，请合并部分内容');
  return { ...article, ...fields, html: safe, blocks: body.length ? body : [{ id: 'empty', type: 'paragraph', runs: [{ text: '' }] }] };
}

export function replaceHtmlNode(html, id, replacement, { preserveId = false } = {}) {
  const tree = htmlTree(html);
  const node = htmlElements(tree).find(node => node.attribs['data-node-id'] === id);
  if (!node) throw new Error('修改区域已变化，请重新选择');
  const parent = node.parent;
  const children = htmlTree(replacement).children;
  const elements = children.filter(child => child.type === 'tag');
  if (preserveId && elements.length === 1 && children.every(child => child.type === 'tag' || child.type === 'text' && !child.data.trim())) elements[0].attribs['data-node-id'] = id;
  parent.children.splice(parent.children.indexOf(node), 1, ...children);
  for (let index = 0; index < parent.children.length; index++) {
    const child = parent.children[index];
    child.parent = parent; child.prev = parent.children[index - 1] || null; child.next = parent.children[index + 1] || null;
  }
  return innerHtml(tree);
}

// Clip text by offsets while retaining every wrapper outside the selected range.
function clip(node, start, end) {
  const length = nodeText(node).length;
  if (start <= 0 && end >= length) return outerHtml(node);
  if (end <= 0 || start >= length) return '';
  if (node.type === 'text') return escapeHtml(node.data.slice(Math.max(0, start), end));
  let offset = 0;
  const content = (node.children || []).map(child => { const result = clip(child, start - offset, end - offset); offset += nodeText(child).length; return result; }).join('');
  return outerHtml(node).replace(innerHtml(node), content);
}
export function replaceHtmlReference(html, reference, replacement) {
  const id = reference.keys[0]?.replace(/^html:/, '');
  const node = findHtmlNode(html, id);
  if (!node) throw new Error('所选内容已变化，请重新选择');
  if (reference.kind === 'image') return replaceHtmlNode(html, id, replacement, { preserveId: true });
  const text = nodeText(node), start = reference.startOffset ?? 0, end = reference.endOffset ?? text.length;
  if (text.slice(start, end) !== reference.text || end <= start) throw new Error('选区文字已变化，请重新选择');
  if (start === 0 && end === text.length) return replaceHtmlNode(html, id, replacement, { preserveId: true });
  const before = clip(node, 0, start), after = clip(node, end, text.length);
  // The boundary node itself is retained; only its selected contents are replaced.
  const contentOf = value => value ? innerHtml(htmlTree(value).children[0]) : '';
  const patched = outerHtml(node).replace(innerHtml(node), contentOf(before) + replacement + contentOf(after));
  return replaceHtmlNode(html, id, patched);
}
