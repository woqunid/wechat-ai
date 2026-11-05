export const paragraphHost = node => (node?.nodeType === 1 ? node : node?.parentElement)?.closest('p,li,h1,h2,h3,h4,blockquote,section,div');
const inlineKeys = ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'color', 'backgroundColor', 'textDecoration', 'letterSpacing'];
const paragraphKeys = ['textAlign', 'lineHeight', 'marginTop', 'marginBottom', 'paddingLeft', 'paddingRight', 'textIndent'];
const common = values => values.every(value => value === values[0]) ? values[0] : null;
const number = value => Math.round((parseFloat(value) || 0) * 100) / 100;
const transparent = value => !value || value === 'transparent' || value === 'rgba(0, 0, 0, 0)';

function overlaps(range, node) {
  const contents = node.ownerDocument.createRange(); contents.selectNodeContents(node);
  const start = range.cloneRange(), end = range.cloneRange(); start.collapse(true); end.collapse(false);
  const nodeStart = contents.cloneRange(), nodeEnd = contents.cloneRange(); nodeStart.collapse(true); nodeEnd.collapse(false);
  return nodeStart.compareBoundaryPoints(Range.START_TO_START, end) < 0 && nodeEnd.compareBoundaryPoints(Range.START_TO_START, start) > 0;
}

export function selectedTextNodes(root, range) {
  if (!range || range.collapsed || !root.contains(range.commonAncestorContainer)) return [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = [];
  while (walker.nextNode()) if (walker.currentNode.length && overlaps(range, walker.currentNode)) nodes.push(walker.currentNode);
  return nodes;
}

export function selectedParagraphs(root, range) {
  if (!range || !root.contains(range.commonAncestorContainer)) return [];
  if (range.collapsed) return [paragraphHost(range.startContainer)].filter(node => node && node !== root);
  const texts = selectedTextNodes(root, range);
  const nodes = [...root.querySelectorAll('p,li,h1,h2,h3,h4,blockquote')].filter(node => overlaps(range, node) &&
    (!node.textContent.length || texts.some(text => node.contains(text))));
  return nodes.length ? nodes.filter(node => !nodes.some(child => child !== node && node.contains(child))) : [paragraphHost(range.startContainer)].filter(node => node && node !== root);
}

function inlineStyle(element, root) {
  const style = getComputedStyle(element);
  let backgroundColor = 'transparent', underline = false;
  for (let parent = element; parent && parent !== root; parent = parent.parentElement) {
    const computed = getComputedStyle(parent);
    if (transparent(backgroundColor) && !transparent(computed.backgroundColor)) backgroundColor = computed.backgroundColor;
    if (computed.textDecorationLine.includes('underline')) underline = true;
  }
  return {
    fontSize: style.fontSize, fontFamily: style.fontFamily,
    fontWeight: Number(style.fontWeight) >= 600 || style.fontWeight === 'bold' ? '700' : '400',
    fontStyle: style.fontStyle, color: style.color, backgroundColor,
    textDecoration: underline ? 'underline' : 'none', letterSpacing: style.letterSpacing === 'normal' ? '0px' : style.letterSpacing,
  };
}

function paragraphType(node) {
  const list = node.closest('ul,ol');
  if (list) return list.tagName.toLowerCase();
  const wrapper = node.closest('[data-block-type]');
  if (wrapper?.dataset.blockType === 'heading') return `h${wrapper.dataset.headingLevel || 2}`;
  if (wrapper?.dataset.blockType === 'quote' || node.closest('blockquote')) return 'blockquote';
  if (wrapper?.dataset.blockType === 'list') return wrapper.dataset.listOrdered === 'false' ? 'ul' : 'ol';
  return /^H[1-4]$/.test(node.tagName) ? node.tagName.toLowerCase() : 'p';
}

export function readSelectionFormat(root, range) {
  const paragraphs = selectedParagraphs(root, range);
  if (!paragraphs.length) return null;
  const texts = selectedTextNodes(root, range);
  let anchor = range.startContainer;
  if (anchor.nodeType === 1) anchor = anchor.childNodes[range.startOffset] || anchor.childNodes[range.startOffset - 1] || anchor;
  const elements = texts.length ? texts.map(node => node.parentElement) : [anchor.nodeType === 1 ? anchor : anchor.parentElement];
  const styles = elements.map(element => inlineStyle(element, root));
  const inline = Object.fromEntries(inlineKeys.map(key => [key, common(styles.map(style => style[key]))]));
  const blockStyles = paragraphs.map(node => {
    const style = getComputedStyle(node);
    return { textAlign: ({ start: 'left', end: 'right' })[style.textAlign] || style.textAlign,
      lineHeight: style.lineHeight === 'normal' ? 'normal' : String(Math.round(parseFloat(style.lineHeight) / parseFloat(style.fontSize) * 100) / 100),
      ...Object.fromEntries(['marginTop', 'marginBottom', 'paddingLeft', 'paddingRight', 'textIndent'].map(key => [key, style[key]])),
    };
  });
  return { inline, paragraph: Object.fromEntries(paragraphKeys.map(key => [key, common(blockStyles.map(style => style[key]))])),
    type: common(paragraphs.map(paragraphType)), count: paragraphs.length, hasText: !range.collapsed && texts.length > 0 };
}

export const formatNumber = value => value === null || value === undefined || value === 'normal' ? '' : number(value);
export function colorHex(value) {
  if (/^#[0-9a-f]{6}$/i.test(value || '')) return value;
  const channels = value?.match(/^rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  return channels ? `#${channels.slice(1, 4).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}` : null;
}

export function applyTextStyle(root, range, patch) {
  if (patch.textDecoration === 'none' || patch.backgroundColor === 'transparent') {
    const selection = root.ownerDocument.getSelection();
    selection.removeAllRanges(); selection.addRange(range);
    if (patch.textDecoration === 'none') {
      if (document.queryCommandIndeterm('underline')) document.execCommand('underline');
      if (document.queryCommandState('underline')) document.execCommand('underline');
    }
    if (patch.backgroundColor === 'transparent') document.execCommand('hiliteColor', false, 'transparent');
    const current = selection.getRangeAt(0);
    range.setStart(current.startContainer, current.startOffset); range.setEnd(current.endContainer, current.endOffset);
  }
  const nodes = selectedTextNodes(root, range);
  if (!nodes.length) return false;
  const start = range.startContainer, end = range.endContainer, startOffset = range.startOffset, endOffset = range.endOffset;
  const selected = nodes.map(node => {
    const from = node === start ? startOffset : 0, to = node === end ? endOffset : node.length;
    if (to < node.length) node.splitText(to);
    const text = from ? node.splitText(from) : node;
    const span = root.ownerDocument.createElement('span'); Object.assign(span.style, patch);
    text.before(span); span.append(text); return text;
  });
  range.setStart(selected[0], 0); range.setEnd(selected.at(-1), selected.at(-1).length);
  return true;
}
