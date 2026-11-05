import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, ArrowDown, ArrowUp, Bold, Eraser, Highlighter, ImagePlus, IndentIncrease, Paintbrush, RotateCcw, Trash2, Underline } from 'lucide-react';
import { articleWithHtml, escapeHtml, findHtmlNode, nodeText, replaceHtmlNode } from './html-document.js';
import { uid } from './core.js';
import { imageLink, readImageLink } from './image-assets.js';
import { renderArticle } from './renderer.js';
import { applyTextStyle, colorHex, formatNumber, paragraphHost as hostOf, readSelectionFormat, selectedParagraphs } from './editor-format.js';

function FormatNumber({ label, value, mixed, min = 0, max = 256, unit = 'px', presets, onChange }) {
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value, mixed]);
  return <label>{label}<span className="editor-number"><input aria-label={label} type="number" min={min} max={max} step="any" list={presets ? id : undefined} value={draft} placeholder={mixed ? '多种' : '—'}
    onChange={event => setDraft(event.target.value)} onBlur={event => {
      const next = Number(event.target.value);
      if (event.target.value !== '' && Number.isFinite(next) && next >= min && next <= max) { if (next !== value) onChange(next); }
      else setDraft(String(value));
    }} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
      if (event.key === 'Escape') { event.currentTarget.value = String(value); setDraft(String(value)); event.currentTarget.blur(); }
    }}/><span>{unit}</span></span>{presets && <datalist id={id}>{presets.map(number => <option key={number} value={number}/>)}</datalist>}</label>;
}

const domText = node => node.nodeType === 3 ? node.data : node.nodeName === 'BR' ? '\n' : node.nodeName === 'IMG' ? '\uFFFC' : [...node.childNodes].map(domText).join('');
const elementOf = node => node?.nodeType === 1 ? node : node?.parentElement;
const imageUnit = img => img?.closest('[data-block-type="imageCard"],[data-block-type="image"]') || img;
const offsetIn = (root, node, offset) => {
  const range = document.createRange(); range.selectNodeContents(root); range.setEnd(node, offset);
  return domText(range.cloneContents()).length;
};
function cursorPoint(root, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: node => node.nodeType === 3 || ['BR', 'IMG'].includes(node.nodeName) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP });
  let node;
  while ((node = walker.nextNode())) {
    const size = node.nodeType === 3 ? node.length : 1;
    if (offset <= size) return node.nodeType === 3 ? [node, Math.max(0, offset)] : [node.parentNode, [...node.parentNode.childNodes].indexOf(node) + (offset > 0 ? 1 : 0)];
    offset -= size;
  }
  return [root, root.childNodes.length];
}
const saveCursor = root => {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  return { start: offsetIn(root, range.startContainer, range.startOffset), end: offsetIn(root, range.endContainer, range.endOffset) };
};
function restoreCursor(root, cursor) {
  if (!cursor) return;
  const range = document.createRange();
  range.setStart(...cursorPoint(root, cursor.start)); range.setEnd(...cursorPoint(root, cursor.end));
  const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
}

export function ArticleEditor({ article, setArticle, template, assets, activeKey, onSelect, onReference, onUpload, onRegisterAsset, onGallery, setToast, displayArticle, readOnly = false, width = 375, changes = [], header, footer }) {
  const canvas = useRef(null);
  const savedRange = useRef(null);
  const composing = useRef(false);
  const visual = useRef('');
  const latest = useRef(article);
  const pendingImages = useRef(new Set());
  const [importing, setImporting] = useState(0);
  const locked = useRef(readOnly);
  locked.current = readOnly;
  latest.current = article;
  const [currentId, setCurrentId] = useState('');
  const [revision, setRevision] = useState(0);
  const [format, setFormat] = useState(null);
  const [copiedFormat, setCopiedFormat] = useState(null);
  const display = displayArticle || article;
  useEffect(() => () => { for (const controller of pendingImages.current) controller.abort(); pendingImages.current.clear(); }, [article.id]);
  const selected = canvas.current?.querySelector(`[data-node-id="${CSS.escape(currentId)}"]`);
  const image = selected?.tagName === 'IMG' ? selected : null;

  const refreshFormat = () => {
    const next = readSelectionFormat(canvas.current, savedRange.current);
    setFormat(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
  };

  const remember = () => {
    const selection = window.getSelection();
    if (!selection.rangeCount || !canvas.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) return;
    savedRange.current = selection.getRangeAt(0).cloneRange();
    const host = hostOf(selection.anchorNode);
    if (host && host !== canvas.current) { setCurrentId(host.dataset.nodeId || ''); onSelect?.(`html:${host.dataset.nodeId}`); }
    refreshFormat();
  };
  useEffect(() => {
    const listener = () => { if (canvas.current?.contains(document.activeElement)) remember(); };
    document.addEventListener('selectionchange', listener);
    return () => document.removeEventListener('selectionchange', listener);
  });
  useLayoutEffect(() => {
    const root = canvas.current;
    const html = renderArticle(display, template, assets, { mode: 'preview', interactive: true }).html;
    const signature = `${readOnly}:${html}`;
    if (visual.current === signature || composing.current) return;
    const focused = root.contains(document.activeElement);
    const previousRange = savedRange.current;
    const cursor = focused ? saveCursor(root) : previousRange && root.contains(previousRange.commonAncestorContainer)
      ? { start: offsetIn(root, previousRange.startContainer, previousRange.startOffset), end: offsetIn(root, previousRange.endContainer, previousRange.endOffset) } : null;
    root.innerHTML = html;
    for (const node of root.querySelectorAll('[data-node-id]')) node.dataset.editorKey = `html:${node.dataset.nodeId}`;
    for (const img of root.querySelectorAll('img')) { img.draggable = !readOnly; img.contentEditable = 'false'; }
    for (const change of changes) root.querySelector(`[data-node-id="${CSS.escape(change.key.replace(/^html:/, ''))}"]`)?.classList.add('ai-proposed-change');
    savedRange.current = null;
    if (cursor && !readOnly) {
      const range = document.createRange(); range.setStart(...cursorPoint(root, cursor.start)); range.setEnd(...cursorPoint(root, cursor.end)); savedRange.current = range;
      if (focused) { restoreCursor(root, cursor); remember(); } else refreshFormat();
    } else setFormat(null);
    visual.current = signature;
    setRevision(value => value + 1);
  }, [display, assets, template, readOnly]);
  useLayoutEffect(() => {
    for (const node of canvas.current.querySelectorAll('.is-linked')) node.classList.remove('is-linked');
    if (activeKey?.startsWith('html:')) canvas.current.querySelector(`[data-node-id="${CSS.escape(activeKey.slice(5))}"]`)?.classList.add('is-linked');
  }, [activeKey, revision]);

  const commit = () => {
    if (readOnly || composing.current) return;
    try {
      const root = canvas.current;
      for (const font of root.querySelectorAll('font')) {
        const span = document.createElement('span'); span.innerHTML = font.innerHTML;
        if (font.color) span.style.color = font.color;
        if (font.face) span.style.fontFamily = font.face;
        span.style.fontSize = getComputedStyle(font).fontSize;
        font.replaceWith(span);
      }
      const next = articleWithHtml(latest.current, root.innerHTML || '<p><br></p>');
      refreshFormat();
      if (next.html === latest.current.html) return;
      const updated = { ...next, updatedAt: new Date().toISOString() };
      latest.current = updated;
      setArticle(updated);
    } catch (error) {
      setToast(error.message);
      visual.current = '';
      rootRestore();
    }
  };
  const rootRestore = () => { canvas.current.innerHTML = renderArticle(latest.current, template, assets, { mode: 'preview', interactive: true }).html; savedRange.current = null; setFormat(null); };
  const restoreSelection = () => {
    const range = savedRange.current;
    if (!range || !canvas.current.contains(range.commonAncestorContainer)) return false;
    canvas.current.focus({ preventScroll: true });
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    return true;
  };
  const command = (name, value) => {
    if (readOnly || !restoreSelection()) { setToast('请先在文章中选择需要修改的文字'); return; }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(name, false, value);
    remember(); commit();
  };
  const targets = () => {
    if (image) return [image];
    const range = savedRange.current;
    if (!range || !canvas.current.contains(range.commonAncestorContainer)) return selected ? [selected] : [];
    return selectedParagraphs(canvas.current, range);
  };
  const patchStyle = patch => {
    if (readOnly) return;
    if ((patch.fontSize || patch.letterSpacing !== undefined) && savedRange.current && !savedRange.current.collapsed && restoreSelection()) {
      applyTextStyle(canvas.current, savedRange.current, patch);
      restoreSelection(); remember(); commit(); return;
    }
    const nodes = targets();
    if (!nodes.length) { setToast('请先选择需要设置的段落或图片'); return; }
    for (const node of nodes) {
      Object.assign(node.style, patch);
      for (const key of ['fontSize', 'lineHeight', 'letterSpacing']) if (patch[key] !== undefined) for (const child of node.querySelectorAll('*:not(img)')) child.style[key] = '';
    }
    restoreSelection(); commit();
  };
  const changeType = (value, reset = false) => {
    if (readOnly) return;
    const nodes = targets().filter(node => node.tagName !== 'IMG');
    if (!nodes.length) { setToast('请先选择需要设置的段落'); return; }
    for (const node of nodes) {
      const wrapper = node.closest('[data-preview-key^="block:"]');
      if (wrapper) for (const attr of ['data-preview-key', 'data-block-type', 'data-heading-level', 'data-list-ordered']) wrapper.removeAttribute(attr);
    }
    let last;
    if (value === 'ul' || value === 'ol') {
      const list = document.createElement(value); list.style.cssText = 'margin:0 0 18px;padding-left:1.5em;';
      nodes[0].before(list);
      for (const node of nodes) {
        const item = document.createElement('li');
        const part = node.querySelector('[data-editor-part="item"]');
        item.innerHTML = part ? part.innerHTML : node.innerHTML;
        item.style.cssText = 'margin:0 0 8px;'; list.append(item); node.remove(); last = item;
      }
    } else for (const node of nodes) {
      const replacement = document.createElement(value);
      for (const attr of [...node.attributes]) if (!['data-block-type', 'data-heading-level', 'data-list-ordered'].includes(attr.name)) replacement.setAttribute(attr.name, attr.value);
      replacement.innerHTML = reset ? (node.querySelector('[data-editor-part="item"]') || node).innerHTML : node.innerHTML;
      Object.assign(replacement.style, { fontSize: value === 'h1' ? '24px' : value === 'h2' ? '20px' : '16px', fontWeight: /^h/.test(value) ? '700' : '400', lineHeight: /^h/.test(value) ? '1.6' : '1.9', marginBottom: '18px' });
      if (value === 'blockquote') Object.assign(replacement.style, { borderLeft: '3px solid #64748B', paddingLeft: '12px' });
      if (reset) {
        const page = article.layoutDesign?.page;
        replacement.removeAttribute('style');
        Object.assign(replacement.style, { fontSize: `${page?.fontSize || template.tokens.bodySize}px`, color: page?.color || template.tokens.text,
          fontWeight: '400', fontStyle: 'normal', textDecoration: 'none', backgroundColor: 'transparent',
          lineHeight: String(page?.lineHeight || template.tokens.lineHeight), letterSpacing: `${template.tokens.letterSpacing || 0}px`,
          textAlign: 'left', textIndent: '0', margin: `0 0 ${page?.paragraphGap ?? template.tokens.paraGap}px`, padding: '0', border: '0' });
        for (const child of replacement.querySelectorAll('*:not(img)')) {
          child.removeAttribute('style');
          Object.assign(child.style, { fontSize: 'inherit', fontWeight: 'inherit', fontStyle: 'normal', textDecoration: 'none', color: 'inherit', backgroundColor: 'transparent' });
        }
      }
      if (node.tagName === 'LI' && ['UL', 'OL'].includes(node.parentElement.tagName)) {
        const list = node.parentElement, tail = list.cloneNode(false);
        while (node.nextSibling) tail.append(node.nextSibling);
        list.after(replacement);
        if (tail.childNodes.length) replacement.after(tail);
        node.remove(); if (!list.childNodes.length) list.remove();
      } else node.replaceWith(replacement);
      last = replacement;
    }
    if (last) {
      canvas.current.focus({ preventScroll: true });
      const range = document.createRange(); range.selectNodeContents(last); range.collapse(false);
      const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    }
    remember(); commit();
  };
  const copyFormat = () => {
    if (readOnly || image || !format) return;
    setCopiedFormat({ inline: Object.fromEntries(Object.entries(format.inline).filter(([, value]) => value !== null)),
      paragraph: Object.fromEntries(Object.entries(format.paragraph).filter(([, value]) => value !== null)) });
    setToast('已复制格式，请选择目标文字或段落后点击“应用格式”');
  };
  const applyFormat = () => {
    if (readOnly || image || !copiedFormat) return;
    const nodes = targets();
    if (!nodes.length || !restoreSelection()) { setToast('请先选择目标文字或段落'); return; }
    const range = savedRange.current;
    const cursor = saveCursor(canvas.current);
    if (!range.collapsed) applyTextStyle(canvas.current, range, copiedFormat.inline);
    for (const node of nodes) {
      Object.assign(node.style, copiedFormat.paragraph);
      if (range.collapsed) {
        const fullRange = document.createRange(); fullRange.selectNodeContents(node);
        applyTextStyle(canvas.current, fullRange, copiedFormat.inline);
        Object.assign(node.style, copiedFormat.inline);
      }
      if (copiedFormat.paragraph.lineHeight !== undefined) for (const child of node.querySelectorAll('*:not(img)')) child.style.lineHeight = '';
    }
    restoreCursor(canvas.current, cursor); remember(); commit();
  };
  const captureReference = event => {
    const img = event.target.closest('img');
    if (img) {
      window.getSelection()?.removeAllRanges();
      setCurrentId(img.dataset.nodeId); savedRange.current = null; setFormat(null);
      onSelect?.(`html:${img.dataset.nodeId}`);
      onReference?.({ kind: 'image', keys: [`html:${img.dataset.nodeId}`], text: img.alt || '文章图片' });
      return;
    }
    remember();
    const range = savedRange.current;
    if (!range || range.collapsed) return;
    let host = elementOf(range.commonAncestorContainer)?.closest('[data-node-id]');
    if (!host || !canvas.current.contains(host)) return;
    // Inline selections use a paragraph boundary so later edits retain their surrounding structure.
    if (['SPAN', 'STRONG', 'B', 'EM', 'I', 'U'].includes(host.tagName)) host = hostOf(host) || host;
    const startOffset = offsetIn(host, range.startContainer, range.startOffset), endOffset = offsetIn(host, range.endContainer, range.endOffset);
    const text = domText(host).slice(startOffset, endOffset);
    if (text.trim()) onReference?.({ kind: 'text', keys: [`html:${host.dataset.nodeId}`], text, startOffset, endOffset });
  };
  const insertIndex = () => {
    const ids = new Set([currentId, ...Array.from(selected?.querySelectorAll('[data-node-id]') || []).map(node => node.dataset.nodeId)]);
    const index = article.blocks.findIndex(block => ids.has(block.id));
    return index < 0 ? article.blocks.length : index + 1;
  };
  const removeImage = () => { if (image && !readOnly) { imageUnit(image).remove(); setCurrentId(''); commit(); } };
  const moveImage = direction => {
    if (!image || readOnly) return;
    const unit = imageUnit(image);
    const sibling = direction < 0 ? unit.previousElementSibling : unit.nextElementSibling;
    if (!sibling) return;
    direction < 0 ? sibling.before(unit) : sibling.after(unit);
    commit();
  };
  const paste = async event => {
    event.preventDefault();
    if (readOnly) return;
    const files = [...event.clipboardData.files].filter(file => file.type.startsWith('image/'));
    if (files.length) { for (const file of files) await onUpload(file, insertIndex()); return; }
    const text = event.clipboardData.getData('text/plain');
    const pastedHtml = event.clipboardData.getData('text/html');
    if (!restoreSelection()) { setToast('请先在文章中放置光标'); return; }
    const url = imageLink(text.trim());
    if (url && onRegisterAsset) {
      const id = uid('link'), articleId = article.id, controller = new AbortController();
      document.execCommand('insertHTML', false, `<span data-node-id="${id}">${escapeHtml(text.trim())}</span>`);
      remember(); commit(); pendingImages.current.add(controller); setImporting(pendingImages.current.size);
      let asset;
      try {
        asset = await readImageLink(url, controller.signal);
        if (controller.signal.aborted || latest.current.id !== articleId) return;
        await onRegisterAsset(asset);
        const current = latest.current, target = findHtmlNode(current.html, id);
        if (controller.signal.aborted || current.id !== articleId) return;
        if (locked.current || !target || nodeText(target) !== text.trim()) { setToast('图片已加入素材，正文当前有变化，请从图片库插入'); return; }
        const html = replaceHtmlNode(current.html, id, `<img data-node-id="${id}" data-asset-id="${asset.id}" alt="文章图片" style="display:block;width:100%;height:auto;">`);
        setArticle({ ...articleWithHtml(current, html), updatedAt: new Date().toISOString() });
      } catch (error) { if (!controller.signal.aborted) setToast(`${error.message}，链接文字已保留`); }
      finally {
        if (asset?.previewUrl) URL.revokeObjectURL(asset.previewUrl);
        pendingImages.current.delete(controller); setImporting(pendingImages.current.size);
      }
      return;
    }
    let safe = escapeHtml(text).replace(/\r?\n/g, '<br>');
    if (pastedHtml) {
      try {
        const doc = new DOMParser().parseFromString(pastedHtml, 'text/html');
        for (const img of doc.querySelectorAll('img')) {
          const asset = [...assets.values()].find(asset => [asset.url, asset.previewUrl, asset.cacheUrl].includes(img.getAttribute('src')));
          if (asset) img.dataset.assetId = asset.id; else img.replaceWith(document.createTextNode(img.alt || ''));
        }
        safe = articleWithHtml(article, doc.body.innerHTML).html;
        // Clipboard node identifiers belong to a different document.
        safe = safe.replace(/ data-(?:node-id|preview-key|editor-part|editor-index|decoration|block-type|heading-level|list-ordered)="[^"]*"/g, '');
      } catch { /* Plain text remains available if pasted HTML is unsupported. */ }
    }
    document.execCommand('insertHTML', false, safe); remember(); commit();
  };
  const copySelection = event => {
    if (!restoreSelection()) return;
    const selection = window.getSelection();
    if (selection.isCollapsed) return;
    const fragment = document.createElement('div'); fragment.append(selection.getRangeAt(0).cloneContents());
    for (const img of fragment.querySelectorAll('img')) {
      const asset = assets.get(img.dataset.assetId);
      if (asset?.url && asset.pasteStatus !== 'broken') img.src = asset.url; else img.remove();
    }
    for (const node of fragment.querySelectorAll('*')) for (const attr of [...node.attributes]) if (attr.name.startsWith('data-') || ['class', 'contenteditable', 'draggable'].includes(attr.name)) node.removeAttribute(attr.name);
    event.preventDefault(); event.clipboardData.setData('text/html', fragment.innerHTML); event.clipboardData.setData('text/plain', selection.toString());
    if (event.type === 'cut' && !readOnly) { selection.deleteFromDocument(); remember(); commit(); }
  };
  const keepSelection = event => event.preventDefault();
  const inline = format?.inline || {}, paragraph = format?.paragraph || {};
  const textScope = image ? '当前图片' : !format ? '请在文章中放置光标或选择文字' : format.hasText ? '选中文字' : '光标处';
  const paragraphScope = format?.count > 1 ? `${format.count} 个段落` : '当前段落';
  return <div className="document-editor">
    <div className="document-editor-body">
      <aside className="document-editor-sidebar">
        <fieldset className="document-toolbar" role="toolbar" aria-label="文字与段落排版" disabled={readOnly}>
          <p className="editor-format-scope" role="status" title="未选中文字时，加粗、下划线和颜色作用于后续输入，字号、字间距和格式刷作用于当前段落。">{image || !format ? textScope : `文字：${textScope} · 段落：${paragraphScope}`}</p>
          <div className="document-toolbar-row">
            <select aria-label="段落类型" value={format?.type || ''} disabled={Boolean(image) || !format} onChange={event => changeType(event.target.value)}><option value="" disabled>{format?.type === null ? '多种段落类型' : '段落类型'}</option><option value="p">正文</option><option value="h1">一级标题</option><option value="h2">二级标题</option><option value="h3">三级标题</option><option value="h4">四级标题</option><option value="blockquote">引用</option><option value="ul">要点列表</option><option value="ol">有序列表</option></select>
            <button aria-label="加粗" aria-pressed={inline.fontWeight === null ? 'mixed' : inline.fontWeight === '700'} disabled={Boolean(image) || !format} title="加粗 Ctrl+B" onMouseDown={keepSelection} onClick={() => command('bold')}><Bold size={16}/></button>
            <button aria-label="下划线" aria-pressed={inline.textDecoration === null ? 'mixed' : inline.textDecoration === 'underline'} disabled={Boolean(image) || !format} title="下划线 Ctrl+U" onMouseDown={keepSelection} onClick={() => command('underline')}><Underline size={16}/></button>
            <button aria-label="清除文字样式" title="清除选中文字的样式，保留段落排版" disabled={Boolean(image) || !format?.hasText} onMouseDown={keepSelection} onClick={() => command('removeFormat')}><Eraser size={16}/></button>
            <label className="editor-color" data-mixed={inline.color === null} style={{ textDecorationColor: inline.color || undefined }} title={inline.color === null ? '文字颜色：多种' : '文字颜色'}>A<input aria-label="文字颜色" type="color" disabled={Boolean(image) || !format} value={colorHex(inline.color) || '#26332f'} onChange={event => command('foreColor', event.target.value)}/></label>
            <label className="editor-color editor-highlight" data-mixed={inline.backgroundColor === null} style={{ backgroundColor: inline.backgroundColor || 'transparent' }} title={inline.backgroundColor === null ? '高亮颜色：多种' : '高亮颜色'}><Highlighter size={16}/><input aria-label="文字高亮颜色" type="color" disabled={Boolean(image) || !format} value={colorHex(inline.backgroundColor) || '#fff2a8'} onChange={event => command('hiliteColor', event.target.value)}/></label>
            <button aria-label="插入图片" title="插入图片" onMouseDown={keepSelection} onClick={() => onGallery(insertIndex())}><ImagePlus size={17}/></button>
          </div>
          {!image && <div className="document-toolbar-row paragraph-controls">
            <FormatNumber label="字号" min={1} max={200} value={formatNumber(inline.fontSize)} mixed={inline.fontSize === null} presets={[12,14,15,16,17,18,20,22,24,28,32,36,40]} onChange={value => patchStyle({ fontSize: `${value}px` })}/>
            <span className="editor-alignments">{[['left', AlignLeft, '左对齐'], ['center', AlignCenter, '居中'], ['right', AlignRight, '右对齐'], ['justify', AlignJustify, '两端对齐']].map(([align, Icon, title]) => <button key={align} aria-label={title} aria-pressed={paragraph.textAlign === null ? 'mixed' : paragraph.textAlign === align} title={title} onMouseDown={keepSelection} onClick={() => patchStyle({ textAlign: align })}><Icon size={15}/></button>)}</span>
            <FormatNumber label="行距" min={0.5} max={10} unit="倍" value={formatNumber(paragraph.lineHeight)} mixed={paragraph.lineHeight === null} presets={[1.2,1.5,1.8,1.9,2,2.5,3]} onChange={value => patchStyle({ lineHeight: String(value) })}/>
            {[['marginTop','段前间距'],['marginBottom','段后间距'],['paddingLeft','左缩进'],['paddingRight','右缩进']].map(([key, label]) => <FormatNumber key={key} label={label} value={formatNumber(paragraph[key])} mixed={paragraph[key] === null} presets={[0,4,8,12,16,18,24,32,48,64]} onChange={value => patchStyle({ [key]: `${value}px` })}/>)}
            <FormatNumber label="字间距" max={20} value={formatNumber(inline.letterSpacing)} mixed={inline.letterSpacing === null} presets={[0,0.5,1,1.5,2,3,4]} onChange={value => patchStyle({ letterSpacing: `${value}px` })}/>
            <button aria-label="首行缩进" aria-pressed={paragraph.textIndent === null ? 'mixed' : parseFloat(paragraph.textIndent) > 0} title="切换首行缩进两字符" onMouseDown={keepSelection} onClick={() => patchStyle({ textIndent: parseFloat(paragraph.textIndent) > 0 ? '0' : '2em' })}><IndentIncrease size={16}/></button>
          </div>}
          {!image && <div className="document-toolbar-row editor-format-actions">
            <button disabled={!format} title="复制当前选区共有的文字和段落格式" onMouseDown={keepSelection} onClick={copyFormat}><Paintbrush size={14}/>复制格式</button>
            <button disabled={!format || !copiedFormat} title="将已复制格式应用到当前选区及所在段落" onMouseDown={keepSelection} onClick={applyFormat}>应用格式</button>
            <button disabled={!format} title="将选中段落恢复为正文，重置文字样式、间距、缩进、背景和边框" onMouseDown={keepSelection} onClick={() => changeType('p', true)}><RotateCcw size={14}/>恢复正文格式</button>
            {copiedFormat && <span className="editor-format-hint">已复制格式，选择目标后应用；混合项保留目标原样式。</span>}
          </div>}
        </fieldset>
        {image && <fieldset className="editor-image-controls" disabled={readOnly}>
          <label>图片宽度 <input aria-label="图片宽度" type="range" min="20" max="100" step="5" value={parseFloat(image.style.width) || 100} onChange={event => patchStyle({ width: `${event.target.value}%` })}/><span>{parseFloat(image.style.width) || 100}%</span></label>
          <div>{[['left','靠左'],['center','居中'],['right','靠右']].map(([align, label]) => <button key={align} onClick={() => patchStyle({ display: 'block', marginLeft: align === 'left' ? '0' : 'auto', marginRight: align === 'right' ? '0' : 'auto' })}>{label}</button>)}
            <button onClick={() => onGallery(article.blocks.findIndex(block => block.id === currentId), currentId)}>替换图片</button>
            <button aria-label="上移图片" onClick={() => moveImage(-1)}><ArrowUp size={14}/>上移</button><button aria-label="下移图片" onClick={() => moveImage(1)}><ArrowDown size={14}/>下移</button>
            <button aria-label="删除图片" onClick={removeImage}><Trash2 size={14}/>删除</button>
          </div>
        </fieldset>}
        {importing > 0 && <p className="editor-uploading" role="status">正在读取 {importing} 个图片链接…</p>}
      </aside>
      <div className="document-editor-content"><div className="canvas-scroll"><div className="canvas-paper" style={{ width }}>
        {header}
        <div className="document-sheet">
          <div ref={canvas} className="document-canvas html-document" role="textbox" aria-label="文章排版画布" aria-multiline="true" aria-readonly={readOnly} contentEditable={!readOnly} suppressContentEditableWarning spellCheck={false}
            onInput={commit} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; commit(); }}
            onMouseUp={captureReference} onKeyUp={event => { remember(); if (event.shiftKey) captureReference(event); }} onPaste={paste} onCopy={copySelection} onCut={copySelection}
            onKeyDown={event => { if ((event.ctrlKey || event.metaKey) && ['b', 'u'].includes(event.key.toLowerCase())) { event.preventDefault(); command(event.key.toLowerCase() === 'b' ? 'bold' : 'underline'); } }}
            onDragStart={event => { const img = event.target.closest('img'); if (!img || readOnly) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-weave-html-image', img.dataset.nodeId); }}
            onDragOver={event => { if (!readOnly) event.preventDefault(); }} onDrop={async event => {
              event.preventDefault(); if (readOnly) return;
              const id = event.dataTransfer.getData('application/x-weave-html-image');
              const assetId = event.dataTransfer.getData('application/x-weave-asset');
              const target = hostOf(event.target);
              if (id) {
                const img = canvas.current.querySelector(`[data-node-id="${CSS.escape(id)}"]`);
                const unit = imageUnit(img);
                if (unit && target && target !== canvas.current && !unit.contains(target) && !target.contains(unit)) { target.after(unit); commit(); }
              } else if (assetId && assets.has(assetId)) {
                const img = document.createElement('img'); img.dataset.assetId = assetId; img.style.cssText = 'display:block;width:100%;max-width:100%;height:auto;';
                if (target && target !== canvas.current) target.after(img); else canvas.current.append(img);
                commit();
              } else for (const file of [...event.dataTransfer.files].filter(file => file.type.startsWith('image/'))) await onUpload(file, insertIndex());
            }}/>
        </div>
      </div>{footer}</div></div>
    </div>
  </div>;
}
