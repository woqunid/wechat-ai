import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, Highlighter, ImagePlus, IndentIncrease, Trash2, Underline } from 'lucide-react';
import { blockText, uid } from './core.js';
import { imageLink, readImageLink } from './image-assets.js';
import { clipboardBlocks, editorBlocks, editorBookmark, editorContent, editorHtml, editorKey, editorParts, editorSelectionHtml, formatEditorSelection, partRuns, prepareEditor, readRenderedBlocks, replaceEditorSelection, restoreBookmark, sliceRuns, withPartRuns } from './editor-dom.js';

const imageBlock = block => block?.type === 'image' || block?.type === 'imageCard';
const plainRuns = runs => runs.map(run => ({ text: run.text }));
const contentFields = ['title', 'summary', 'titleFormat', 'summaryFormat', 'blocks'];

export function ArticleEditor({ article, setArticle, template, assets, activeKey, onSelect, onReference, onUpload, onRegisterAsset, onGallery, setToast, displayArticle, readOnly = false, width = 375, changes = [], header, footer }) {
  const canvas = useRef();
  const sheet = useRef();
  const bookmark = useRef(null);
  const localContent = useRef(null);
  const visualSource = useRef(null);
  const pendingRestore = useRef(false);
  const composing = useRef(false);
  const typingFormat = useRef(null);
  const lastSelected = useRef(null);
  const [selection, setSelection] = useState(null);
  const [drop, setDrop] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const pendingImages = useRef(new Map());
  const latestArticle = useRef(article);
  const display = displayArticle || article;
  latestArticle.current = article;
  const content = useMemo(() => editorBlocks(article), [article.title, article.summary, article.titleFormat, article.summaryFormat, article.blocks]);
  const selectedId = activeKey === 'title' || activeKey === 'summary' ? `$${activeKey}` : activeKey?.startsWith('block:') ? activeKey.slice(6) : selection?.startId;
  const current = content.find(block => block.id === selectedId) || (!activeKey ? content[0] : undefined);
  const chosen = bookmark.current && current && bookmark.current.startId === current.id ? bookmark.current.ids.filter(id => content.some(block => block.id === id)) : [];
  const selectedIds = chosen.length ? chosen : current ? [current.id] : [];
  const currentStyle = current?.style || {};

  const remember = () => {
    if (document.activeElement?.matches('.editor-image, [data-block-type="divider"]')) return;
    const next = editorBookmark(canvas.current);
    if (!next) return;
    bookmark.current = next;
    setSelection(next);
    if (lastSelected.current !== next.startId) {
      lastSelected.current = next.startId;
      onSelect?.(editorKey(next.startId));
    }
  };
  const referenceImage = id => {
    const block = article.blocks.find(block => block.id === id);
    if (imageBlock(block)) onReference?.({ kind: 'image', keys: [`block:${id}`], text: blockText(block) || '文章图片' });
  };
  const captureReference = event => {
    remember();
    const figure = event.target.closest('.editor-image');
    if (figure && !event.target.closest('[data-editor-part]')) { referenceImage(figure.dataset.blockId); return; }
    const saved = editorBookmark(canvas.current);
    if (!saved || saved.collapsed) return;
    if (saved.text.trim()) onReference?.({ kind: 'text', keys: saved.ids.map(editorKey), text: saved.text, startOffset: saved.startOffset, endOffset: saved.endOffset });
    saved.ids.forEach(referenceImage);
  };
  useEffect(() => {
    const listener = () => { if (canvas.current?.contains(document.activeElement)) remember(); };
    document.addEventListener('selectionchange', listener);
    return () => document.removeEventListener('selectionchange', listener);
  });
  useEffect(() => () => {
    for (const controller of pendingImages.current.values()) controller.abort();
    pendingImages.current.clear();
  }, [article.id]);
  useEffect(() => { setImportCount(0); }, [article.id]);
  useEffect(() => {
    const id = activeKey === 'title' || activeKey === 'summary' ? `$${activeKey}` : activeKey?.startsWith('block:') ? activeKey.slice(6) : null;
    if (bookmark.current && bookmark.current.startId !== id) { bookmark.current = null; setSelection(null); }
    if (imageBlock(article.blocks.find(block => block.id === id)) && document.activeElement === canvas.current) {
      window.getSelection()?.removeAllRanges();
      canvas.current.blur();
    }
    lastSelected.current = id;
  }, [activeKey]);

  useLayoutEffect(() => {
    const root = canvas.current;
    if (!root || composing.current) return;
    if (contentFields.every(key => localContent.current?.[key] === article[key]) && visualSource.current?.template === template && visualSource.current?.assets === assets && visualSource.current?.display === displayArticle && visualSource.current?.layout === display.layoutDesign && visualSource.current?.readOnly === readOnly) return;
    const focused = root.contains(document.activeElement);
    const saved = bookmark.current;
    root.innerHTML = editorHtml(display, assets, template);
    prepareEditor(root, editorBlocks(display), readOnly);
    for (const change of changes) root.querySelector(`[data-preview-key="${CSS.escape(change.key)}"]`)?.classList.add('ai-proposed-change');
    localContent.current = article;
    visualSource.current = { template, assets, display: displayArticle, layout: display.layoutDesign, readOnly };
    const sameTarget = !activeKey || activeKey === editorKey(saved?.startId);
    if (!readOnly && (focused || pendingRestore.current) && saved && sameTarget) restoreBookmark(root, saved);
    else if (focused && !sameTarget) document.activeElement?.blur();
    pendingRestore.current = false;
  }, [content, assets, template, article.layoutDesign, displayArticle, readOnly]);

  useLayoutEffect(() => {
    canvas.current?.querySelector('.is-linked')?.classList.remove('is-linked');
    if (activeKey) canvas.current?.querySelector(`[data-editor-key="${CSS.escape(activeKey)}"]`)?.classList.add('is-linked');
  }, [activeKey, content, template, assets, displayArticle, readOnly]);

  const publish = (blocks, fields = {}) => {
    if (readOnly) return false;
    if (!blocks.length) blocks = [{ id: uid('b'), type: 'paragraph', runs: [{ text: '' }] }];
    if (blocks.length > 120) { setToast('正文最多保留 120 个段落，请先合并部分内容'); return false; }
    if (blocks.filter(imageBlock).length > 10) { setToast('正文最多添加 10 张图片'); return false; }
    if ((fields.title ?? article.title).length > 80 || (fields.summary ?? article.summary).length > 120) { setToast('标题最多 80 字，摘要最多 120 字，请将较长内容放入正文'); return false; }
    if (blocks.some(block => block.type === 'heading' && block.text.length > 120 || block.cite?.length > 120 || block.caption?.length > 300 || block.title?.length > 80 || block.items?.length > 30)) { setToast('小标题或引文出处最多 120 字，图注最多 300 字，列表最多 30 项'); return false; }
    localContent.current = null;
    pendingRestore.current = true;
    setArticle(previous => ({ ...previous, ...fields, blocks, updatedAt: new Date().toISOString() }));
    return true;
  };
  const publishContent = blocks => {
    const { blocks: body, ...fields } = editorContent(blocks);
    return publish(body, fields);
  };
  const commit = () => {
    if (readOnly || composing.current) return;
    let blocks = readRenderedBlocks(canvas.current, content);
    const pending = typingFormat.current;
    if (pending) {
      const before = content.find(block => block.id === pending.id), after = blocks.find(block => block.id === pending.id);
      if (before && after) {
        const oldText = partRuns(before, pending.part).map(run => run.text).join(''), newText = partRuns(after, pending.part).map(run => run.text).join('');
        const added = newText.length - oldText.length;
        if (added > 0 && newText.slice(0, pending.offset) === oldText.slice(0, pending.offset) && newText.slice(pending.offset + added) === oldText.slice(pending.offset)) {
          blocks = formatEditorSelection(blocks, { startId: pending.id, endId: pending.id, startPart: pending.part, endPart: pending.part, startOffset: pending.offset, endOffset: pending.offset + added, collapsed: false }, pending.format);
          pending.offset += added;
        } else typingFormat.current = null;
      }
    }
    remember();
    if (!publishContent(blocks)) {
      canvas.current.innerHTML = editorHtml(article, assets, template);
      prepareEditor(canvas.current, content);
      restoreBookmark(canvas.current, bookmark.current);
    }
  };
  const command = (name, value) => {
    if (readOnly) return;
    if (!restoreBookmark(canvas.current, bookmark.current)) { setToast('先在文章中选择需要修改的文字'); return; }
    const saved = bookmark.current, block = content.find(block => block.id === saved.startId);
    const pending = typingFormat.current;
    const format = saved.collapsed && pending?.id === saved.startId && pending.part === saved.startPart && pending.offset === saved.startOffset ? pending.format
      : sliceRuns(partRuns(block, saved.startPart), Math.max(0, saved.startOffset - (saved.collapsed ? 1 : 0)))[0] || {};
    const patch = name === 'bold' ? { bold: !format.bold } : name === 'underline' ? { underline: !format.underline }
      : name === 'foreColor' ? { color: value } : name === 'hiliteColor' ? { highlight: value } : null;
    if (saved.collapsed) {
      const { text, ...base } = format;
      typingFormat.current = { id: saved.startId, part: saved.startPart, offset: saved.startOffset, format: patch ? { ...base, ...patch } : { bold: false, underline: false, color: undefined, highlight: undefined } };
      setSelection({ ...saved });
    } else {
      typingFormat.current = null;
      publishContent(formatEditorSelection(content, saved, patch));
    }
  };
  const patchStyle = patch => {
    publishContent(content.map(block => selectedIds.includes(block.id) ? { ...block, style: { ...block.style, ...patch } } : block));
  };
  const resetStyle = () => {
    publishContent(content.map(block => {
      if (!selectedIds.includes(block.id)) return block;
      const { style, ...next } = block;
      if (next.runs) next.runs = plainRuns(next.runs);
      if (next.items) next.items = next.items.map(plainRuns);
      return next;
    }));
  };
  const changeType = value => {
    publishContent(content.map(block => {
      if (block.field) return block;
      if (!selectedIds.includes(block.id) || imageBlock(block)) return block;
      const runs = block.runs || (block.type === 'heading' ? [{ text: block.text }] : block.items?.flatMap((item, i) => i ? [{ text: '\n' }, ...item] : item)) || [{ text: '' }];
      const base = { id: block.id, ...(block.style ? { style: block.style } : {}) };
      if (value.startsWith('heading')) return { ...base, type: 'heading', level: value === 'heading1' ? 1 : 2, text: runs.map(run => run.text).join(''), runs };
      if (value === 'list' || value === 'ordered') return { ...base, type: 'list', ordered: value === 'ordered', items: block.items || [runs] };
      if (value === 'divider') return { ...base, type: 'divider' };
      return { ...base, type: value, runs, ...(value === 'quote' ? { cite: block.cite || '' } : {}) };
    }));
  };
  const applyContent = result => {
    if (!result || readOnly) return;
    const previous = bookmark.current;
    bookmark.current = result.bookmark;
    if (publishContent(result.blocks)) {
      setSelection(result.bookmark);
      lastSelected.current = result.bookmark.startId;
      onSelect?.(editorKey(result.bookmark.startId));
    } else bookmark.current = previous;
  };
  const cursorAt = (id, part = 'runs', offset = 0) => ({ startId: id, endId: id, startPart: part, endPart: part, startOffset: offset, endOffset: offset, ids: [id], collapsed: true, text: '' });
  const focusPart = (block, part, offset = 0) => {
    const saved = cursorAt(block.id, part, offset);
    bookmark.current = saved;
    restoreBookmark(canvas.current, saved);
    remember();
  };
  const splitParagraph = event => {
    if (readOnly || event.isComposing || composing.current) return;
    const selected = event.target?.closest('[data-block-id]');
    if (selected && !event.target.closest('[data-editor-part]') && ['Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault();
      publish(article.blocks.filter(block => block.id !== selected.dataset.blockId));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['b', 'u'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      command(event.key.toLowerCase() === 'b' ? 'bold' : 'underline');
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      const nodes = [...canvas.current.querySelectorAll('[data-editor-part]')];
      const first = nodes[0], last = nodes.at(-1);
      if (first && last) {
        const range = document.createRange();
        range.selectNodeContents(first);
        range.setEnd(last, last.childNodes.length);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        remember();
      }
      return;
    }
    const saved = editorBookmark(canvas.current);
    if (!saved) return;
    const block = content.find(block => block.id === saved.startId), part = saved.startPart;
    const runs = partRuns(block, part), length = runs.reduce((n, run) => n + run.text.length, 0);
    if (['Backspace', 'Delete'].includes(event.key)) {
      if (!saved.collapsed) { event.preventDefault(); applyContent(replaceEditorSelection(content, saved)); return; }
      const backward = event.key === 'Backspace';
      if (backward ? saved.startOffset !== 0 : saved.endOffset !== length) return;
      event.preventDefault();
      if (part.startsWith('item:')) {
        const index = Number(part.slice(5)), adjacent = backward ? index - 1 : index + 1;
        if (block.items[adjacent]) {
          const firstIndex = Math.min(index, adjacent), first = block.items[firstIndex], second = block.items[firstIndex + 1];
          const offset = first.reduce((n, run) => n + run.text.length, 0);
          const items = [...block.items]; items.splice(firstIndex, 2, [...first, ...second]);
          applyContent({ blocks: content.map(value => value.id === block.id ? { ...value, items } : value), bookmark: cursorAt(block.id, `item:${firstIndex}`, offset) });
          return;
        }
      }
      const index = content.indexOf(block), adjacent = content[index + (backward ? -1 : 1)];
      if (!adjacent) return;
      if (imageBlock(adjacent) || adjacent.type === 'divider') {
        canvas.current.querySelector(`[data-block-id="${CSS.escape(adjacent.id)}"]`)?.focus();
        onSelect?.(editorKey(adjacent.id));
      } else if (!block.field && !adjacent.field && ['paragraph', 'heading', 'callout'].includes(block.type) && ['paragraph', 'heading', 'callout'].includes(adjacent.type) && part === 'runs') {
        const first = backward ? adjacent : block, last = backward ? block : adjacent;
        const offset = partRuns(first).reduce((n, run) => n + run.text.length, 0);
        applyContent(replaceEditorSelection(content, { ...saved, startId: first.id, endId: last.id, startPart: 'runs', endPart: 'runs', startOffset: offset, endOffset: 0 }));
      } else {
        const nextPart = backward ? editorParts(adjacent).at(-1) : editorParts(adjacent)[0];
        focusPart(adjacent, nextPart, backward ? partRuns(adjacent, nextPart).reduce((n, run) => n + run.text.length, 0) : 0);
      }
      return;
    }
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (event.shiftKey) { applyContent(replaceEditorSelection(content, saved, [{ text: '\n' }])); return; }
    const result = saved.collapsed ? { blocks: content, bookmark: saved } : replaceEditorSelection(content, saved);
    if (!result) return;
    const source = result.blocks, cursor = result.bookmark;
    const target = source.find(value => value.id === cursor.startId), targetPart = cursor.startPart;
    const targetRuns = partRuns(target, targetPart), targetLength = targetRuns.reduce((n, run) => n + run.text.length, 0);
    if (target.field) {
      const next = source[source.indexOf(target) + 1];
      if (cursor.startOffset === targetLength && next && editorParts(next).length) {
        if (!saved.collapsed) applyContent({ blocks: source, bookmark: cursorAt(next.id, editorParts(next)[0]) });
        else focusPart(next, editorParts(next)[0]);
      } else applyContent(replaceEditorSelection(source, cursor, [{ text: '\n' }]));
      return;
    }
    const prefix = sliceRuns(targetRuns, 0, cursor.startOffset), suffix = sliceRuns(targetRuns, cursor.endOffset);
    if (targetPart.startsWith('item:') && targetLength) {
      const index = Number(targetPart.slice(5)), items = [...target.items];
      items.splice(index, 1, prefix.length ? prefix : [{ text: '' }], suffix.length ? suffix : [{ text: '' }]);
      applyContent({ blocks: source.map(value => value.id === target.id ? { ...value, items } : value), bookmark: cursorAt(target.id, `item:${index + 1}`) });
      return;
    }
    const id = uid('b'), next = { id, type: 'paragraph', runs: targetPart === 'runs' ? suffix.length ? suffix : [{ text: '' }] : [{ text: '' }], ...(target.style && targetPart === 'runs' && target.type === 'paragraph' ? { style: target.style } : {}) };
    const blocks = [...source], index = blocks.indexOf(target);
    if (targetPart.startsWith('item:')) {
      const itemIndex = Number(targetPart.slice(5)), before = target.items.slice(0, itemIndex), after = target.items.slice(itemIndex + 1);
      blocks.splice(index, 1, ...(before.length ? [{ ...target, items: before }] : []), next, ...(after.length ? [{ ...target, id: uid('b'), items: after }] : []));
    } else {
      if (targetPart === 'runs') blocks[index] = withPartRuns(target, targetPart, prefix);
      blocks.splice(index + 1, 0, next);
    }
    applyContent({ blocks, bookmark: cursorAt(id) });
  };
  const insertIndex = () => {
    if (['$title', '$summary'].includes(bookmark.current?.endId || selectedId)) return 0;
    const index = article.blocks.findIndex(block => block.id === (bookmark.current?.endId || selectedId));
    return index < 0 ? article.blocks.length : index + 1;
  };
  const uploadFiles = async (files, index) => {
    const images = Array.from(files).filter(file => /^image\/(jpeg|png|webp)$/.test(file.type));
    const beforeId = article.blocks[index]?.id || null;
    const available = Math.min(10 - article.blocks.filter(imageBlock).length, 120 - article.blocks.length);
    if (!images.length) { setToast('支持粘贴或拖入 JPG、PNG、WebP 图片'); return; }
    if (images.length > available) setToast('正文最多添加 10 张图片，超出的图片未插入');
    setUploading(true);
    try {
      let offset = 0;
      for (const file of images.slice(0, Math.max(0, available))) {
        const id = await onUpload(file, index + offset, null, beforeId);
        if (id) { offset++; onSelect(`block:${id}`); }
      }
    } finally { setUploading(false); }
  };
  const insertAsset = (assetId, index = insertIndex()) => {
    const id = uid('b');
    const blocks = [...article.blocks];
    blocks.splice(index, 0, { id, type: 'imageCard', assetId, caption: '' });
    if (publish(blocks)) onSelect(`block:${id}`);
  };
  const pasteImageLink = async (url, text) => {
    const blocks = [...article.blocks];
    const index = insertIndex();
    const previous = blocks[index - 1];
    const blank = previous?.type === 'paragraph' && !blockText(previous).trim();
    const id = blank ? previous.id : uid('b');
    const placeholder = { id, type: 'paragraph', runs: [{ text }] };
    if (blank) blocks[index - 1] = { ...previous, runs: placeholder.runs };
    else blocks.splice(index, 0, placeholder);
    if (!publish(blocks)) return;
    onSelect(`block:${id}`);
    const controller = new AbortController();
    pendingImages.current.set(id, controller);
    setImportCount(pendingImages.current.size);
    let asset;
    try {
      asset = await readImageLink(url, controller.signal);
      if (controller.signal.aborted || latestArticle.current.id !== article.id) return;
      await onRegisterAsset(asset);
      if (controller.signal.aborted || latestArticle.current.id !== article.id) return;
      const current = latestArticle.current;
      const target = current.blocks.find(block => block.id === id);
      if (target?.type !== 'paragraph' || blockText(target) !== text) { setToast('图片已加入素材，原位置已有修改，未覆盖正文'); return; }
      if (current.blocks.filter(imageBlock).length >= 10) { setToast('图片已加入素材，正文最多添加 10 张图片，链接文字已保留'); return; }
      setArticle(a => {
        if (a.id !== article.id || a.blocks.filter(imageBlock).length >= 10) return a;
        return { ...a, blocks: a.blocks.map(block => block.id === id && block.type === 'paragraph' && blockText(block) === text ? { id, type: 'imageCard', assetId: asset.id, caption: '', ...(block.style?.align ? { style: { align: block.style.align } } : {}) } : block), updatedAt: new Date().toISOString() };
      });
    } catch (error) {
      if (!controller.signal.aborted) setToast(`${error.name === 'TimeoutError' ? '图片读取超时' : error.message}，链接文字已保留`);
    } finally {
      if (asset) URL.revokeObjectURL(asset.previewUrl);
      if (pendingImages.current.get(id) === controller) {
        pendingImages.current.delete(id);
        setImportCount(pendingImages.current.size);
      }
    }
  };
  const copySelection = event => {
    const saved = editorBookmark(canvas.current);
    if (!saved || saved.collapsed) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', saved.text);
    event.clipboardData.setData('text/html', editorSelectionHtml(canvas.current, saved));
    if (event.type === 'cut' && !readOnly) applyContent(replaceEditorSelection(content, saved));
  };
  const paste = event => {
    event.preventDefault();
    if (readOnly) return;
    remember();
    if (event.clipboardData.files.length) { uploadFiles(event.clipboardData.files, insertIndex()); return; }
    const saved = editorBookmark(canvas.current) || bookmark.current;
    if (!saved) return;
    const text = event.clipboardData.getData('text/plain');
    const url = imageLink(text.trim());
    if (url && !current?.field && saved.startPart === 'runs') { pasteImageLink(url, text.trim()); return; }
    const pasted = clipboardBlocks(event.clipboardData.getData('text/html'), text, assets);
    if (current?.field || saved.startPart !== 'runs') {
      applyContent(replaceEditorSelection(content, saved, [{ text: text || pasted.map(blockText).join('\n') }]));
      return;
    }
    if (pasted.length === 1 && pasted[0].type === 'paragraph') {
      applyContent(replaceEditorSelection(content, saved, pasted[0].runs));
      return;
    }
    const result = replaceEditorSelection(content, saved);
    if (!result) return;
    const index = result.blocks.findIndex(block => block.id === saved.startId), host = result.blocks[index];
    const prefix = sliceRuns(partRuns(host), 0, saved.startOffset), suffix = sliceRuns(partRuns(host), saved.startOffset);
    const inserted = [...pasted];
    if (inserted[0]?.runs) inserted[0] = withPartRuns(inserted[0], 'runs', [...prefix, ...inserted[0].runs]);
    else if (prefix.length) inserted.unshift(withPartRuns(host, 'runs', prefix));
    let last = inserted.at(-1), lastPart = editorParts(last).at(-1) || 'runs';
    const offset = partRuns(last, lastPart)?.reduce((n, run) => n + run.text.length, 0) || 0;
    if (last.runs) inserted[inserted.length - 1] = withPartRuns(last, 'runs', [...last.runs, ...suffix]);
    else if (suffix.length) inserted.push({ id: uid('b'), type: 'paragraph', runs: suffix });
    result.blocks.splice(index, 1, ...inserted);
    if (last.type === 'divider') { last = { id: uid('b'), type: 'paragraph', runs: [{ text: '' }] }; result.blocks.splice(index + inserted.length, 0, last); lastPart = 'runs'; }
    result.bookmark = cursorAt(last.id, lastPart, offset);
    applyContent(result);
  };
  const beforeInput = event => {
    if (readOnly) { event.preventDefault(); return; }
    if (composing.current || event.isComposing) return;
    if (event.inputType === 'insertParagraph' || event.inputType === 'insertLineBreak') {
      splitParagraph({ key: 'Enter', shiftKey: event.inputType === 'insertLineBreak', target: event.target, preventDefault: () => event.preventDefault() });
    } else if (['deleteContentBackward', 'deleteContentForward'].includes(event.inputType)) {
      splitParagraph({ key: event.inputType === 'deleteContentBackward' ? 'Backspace' : 'Delete', target: event.target, preventDefault: () => event.preventDefault() });
    } else {
      const saved = editorBookmark(canvas.current);
      const pending = typingFormat.current;
      if (saved?.collapsed && pending && pending.id === saved.startId && pending.part === saved.startPart && pending.offset === saved.startOffset && event.inputType === 'insertText' && event.data !== null) {
        event.preventDefault();
        pending.offset += event.data.length;
        applyContent(replaceEditorSelection(content, saved, [{ ...pending.format, text: event.data }]));
      } else if (saved && (saved.startId !== saved.endId || saved.startPart !== saved.endPart)) {
        event.preventDefault();
        if (event.inputType.startsWith('delete')) applyContent(replaceEditorSelection(content, saved));
        else if (event.data !== null) applyContent(replaceEditorSelection(content, saved, [{ text: event.data }]));
      }
    }
  };
  useEffect(() => {
    const root = canvas.current;
    root?.addEventListener('beforeinput', beforeInput);
    return () => root?.removeEventListener('beforeinput', beforeInput);
  });
  const dropPosition = event => {
    const element = event.target.closest('[data-block-id]');
    if (!element || !canvas.current.contains(element)) return { index: article.blocks.length, top: canvas.current.offsetHeight };
    const index = article.blocks.findIndex(block => block.id === element.dataset.blockId);
    const rect = element.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    return { index: index < 0 ? 0 : index + (after ? 1 : 0), top: rect.top - sheet.current.getBoundingClientRect().top + (after ? rect.height : 0) };
  };
  const dragOver = event => {
    if (readOnly) return;
    if (!Array.from(event.dataTransfer.types).some(type => ['Files', 'application/x-weave-block', 'application/x-weave-asset'].includes(type))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-weave-block') ? 'move' : 'copy';
    setDrop(dropPosition(event));
  };
  const dropImage = event => {
    if (readOnly) { event.preventDefault(); return; }
    const id = event.dataTransfer.getData('application/x-weave-block');
    const assetId = event.dataTransfer.getData('application/x-weave-asset');
    if (!id && !assetId && !event.dataTransfer.files.length) {
      event.preventDefault();
      const text = event.dataTransfer.getData('text/plain');
      const html = event.dataTransfer.getData('text/html');
      if (!text && !html) return;
      const pasted = clipboardBlocks(html, text, assets);
      const blocks = [...article.blocks];
      blocks.splice(dropPosition(event).index, 0, ...pasted);
      if (publish(blocks)) onSelect(`block:${pasted[0].id}`);
      return;
    }
    event.preventDefault();
    const { index } = dropPosition(event);
    setDrop(null);
    if (id) {
      const from = article.blocks.findIndex(block => block.id === id);
      if (from < 0) return;
      const blocks = [...article.blocks];
      const [moving] = blocks.splice(from, 1);
      blocks.splice(index > from ? index - 1 : index, 0, moving);
      publish(blocks);
      onSelect(`block:${id}`);
    } else if (assetId && assets.has(assetId)) insertAsset(assetId, index);
    else if (event.dataTransfer.files.length) uploadFiles(event.dataTransfer.files, index);
  };
  const resizeImage = event => {
    if (readOnly || !event.target.hasAttribute('data-resize-handle')) return;
    event.preventDefault(); event.stopPropagation();
    const figure = event.target.closest('.editor-image');
    const id = figure.dataset.blockId;
    const startX = event.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const parentStyle = getComputedStyle(figure.parentElement);
    const available = figure.parentElement.clientWidth - parseFloat(parentStyle.paddingLeft) - parseFloat(parentStyle.paddingRight);
    const saved = article.blocks;
    let width = Math.round(startWidth / available * 100);
    const handle = event.target;
    handle.setPointerCapture(event.pointerId);
    const move = pointer => {
      const direction = figure.dataset.imageAlign === 'right' ? -1 : figure.dataset.imageAlign === 'center' ? 2 : 1;
      width = Math.max(20, Math.min(100, Math.round((startWidth + (pointer.clientX - startX) * direction) / available * 100)));
      figure.style.width = `${width}%`;
    };
    const finish = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', finish);
      handle.removeEventListener('pointercancel', finish);
      publish(saved.map(block => block.id === id ? { ...block, style: { ...block.style, imageWidth: width } } : block));
      onSelect(`block:${id}`);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  };
  const keepSelection = event => event.preventDefault();
  const valueType = current?.type === 'heading' ? `heading${current.level}` : current?.type === 'list' && current.ordered ? 'ordered' : current?.type || 'paragraph';

  return <div className="document-editor">
    <div className="document-editor-body">
      <aside className="document-editor-sidebar">
        <fieldset className="document-toolbar" role="toolbar" aria-label="文字与段落排版" disabled={readOnly}>
          <div className="document-toolbar-row">
            <select aria-label="段落类型" value={current?.field || (imageBlock(current) ? 'image' : valueType)} onChange={event => changeType(event.target.value)} disabled={imageBlock(current) || Boolean(current?.field)}>
              <option value="title" disabled>文章标题</option><option value="summary" disabled>摘要</option>
              <option value="paragraph">正文</option><option value="heading1">一级标题</option><option value="heading2">二级标题</option><option value="quote">引用</option><option value="callout">重点提示</option><option value="list">要点列表</option><option value="ordered">有序列表</option><option value="divider">分隔线</option><option value="image" disabled>图片</option>
            </select>
            <button title="选中文字加粗 Ctrl+B" aria-label="加粗" onMouseDown={keepSelection} onClick={() => command('bold')} disabled={imageBlock(current)}><Bold size={16}/></button>
            <button title="选中文字加下划线 Ctrl+U" aria-label="下划线" onMouseDown={keepSelection} onClick={() => command('underline')} disabled={imageBlock(current)}><Underline size={16}/></button>
            <button title="清除选中文字的样式" aria-label="清除文字样式" onMouseDown={keepSelection} onClick={() => command('removeFormat')} disabled={imageBlock(current)}><Eraser size={16}/></button>
            <label className="editor-color" title="选中文字颜色">A<input aria-label="文字颜色" type="color" defaultValue="#0f766e" onChange={event => command('foreColor', event.target.value)} disabled={imageBlock(current)}/></label>
            <label className="editor-color editor-highlight" title="选中文字高亮"><Highlighter size={16}/><input aria-label="文字高亮颜色" type="color" defaultValue="#fff2a8" onChange={event => command('hiliteColor', event.target.value)} disabled={imageBlock(current)}/></label>
            <button title="在当前段落后插入图片" aria-label="插入图片" aria-haspopup="dialog" onMouseDown={keepSelection} onClick={() => onGallery(insertIndex())}><ImagePlus size={17}/></button>
            <button className="editor-reset" title="清除所选段落的手动样式，恢复模板" onMouseDown={keepSelection} onClick={resetStyle}>恢复模板</button>
          </div>
          {!imageBlock(current) && <div className="document-toolbar-row paragraph-controls">
            <label>字号<select aria-label="段落字号" value={currentStyle.fontSize || ''} onChange={event => patchStyle({ fontSize: Number(event.target.value) })}><option value="" disabled>模板</option>{[12,14,15,16,17,18,20,22,24,28,32,36,40].map(size => <option key={size} value={size}>{size}</option>)}</select></label>
            <span className="editor-alignments">{[['left', AlignLeft, '左对齐'], ['center', AlignCenter, '居中'], ['right', AlignRight, '右对齐'], ['justify', AlignJustify, '两端对齐']].map(([align, Icon, title]) => <button key={align} title={title} aria-label={title} aria-pressed={(currentStyle.align || 'left') === align} onMouseDown={keepSelection} onClick={() => patchStyle({ align })}><Icon size={15}/></button>)}</span>
            <label>行距<select aria-label="段落行距" value={currentStyle.lineHeight || ''} onChange={event => patchStyle({ lineHeight: Number(event.target.value) })}><option value="" disabled>模板</option>{[1.2,1.5,1.8,2,2.5,3].map(value => <option key={value}>{value}</option>)}</select></label>
            <label>段距<select aria-label="段后间距" value={currentStyle.paragraphSpacing ?? ''} onChange={event => patchStyle({ paragraphSpacing: Number(event.target.value) })}><option value="" disabled>模板</option>{[0,8,12,16,18,24,32,48,64].map(value => <option key={value}>{value}</option>)}</select></label>
            <button title="切换首行缩进两字" aria-label="首行缩进" aria-pressed={Boolean(currentStyle.indent)} onMouseDown={keepSelection} onClick={() => patchStyle({ indent: currentStyle.indent ? 0 : 2 })}><IndentIncrease size={16}/></button>
          </div>}
        </fieldset>
        {imageBlock(current) && <fieldset className="editor-image-controls" disabled={readOnly}><label>图片宽度 <input aria-label="图片宽度" type="range" min="20" max="100" step="5" value={currentStyle.imageWidth || 100} onChange={event => patchStyle({ imageWidth: Number(event.target.value) })}/><span>{currentStyle.imageWidth || 100}%</span></label><div>{[['left','靠左'],['center','居中'],['right','靠右']].map(([align,label]) => <button key={align} aria-pressed={(currentStyle.align || 'left') === align} onClick={() => patchStyle({ align })}>{label}</button>)}<button onClick={() => onGallery(article.blocks.findIndex(block => block.id === current.id), current.id)}>替换图片</button><button title="删除当前图片，可撤销" aria-label="删除图片" onClick={() => publish(article.blocks.filter(block => block.id !== current.id))}><Trash2 size={14}/></button></div></fieldset>}
        {uploading && <p className="editor-uploading" role="status">图片上传中…</p>}
        {importCount > 0 && <p className="editor-uploading" role="status">正在识别 {importCount} 个图片链接，链接文字已保留…</p>}
      </aside>
      <div className="document-editor-content">
        <div className="canvas-scroll"><div className="canvas-paper" style={{ width }}>
          {header}
          <div className="document-sheet" ref={sheet} onDragOver={dragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null); }} onDrop={dropImage}>
            {drop && <div className="editor-drop-line" style={{ top: drop.top }} aria-hidden="true"/>}
            <div ref={canvas} className="document-canvas" role="textbox" aria-label="文章排版画布" aria-multiline="true" aria-readonly={readOnly} contentEditable={false} suppressContentEditableWarning spellCheck={false}
              onInput={commit} onPaste={paste} onCopy={copySelection} onCut={copySelection} onKeyDown={splitParagraph} onMouseUp={captureReference} onKeyUp={event => { remember(); if (!event.shiftKey) captureReference(event); }} onFocus={event => {
                if (event.target.matches('.editor-image, [data-block-type="divider"]')) {
                  bookmark.current = null;
                  setSelection(null);
                  window.getSelection()?.removeAllRanges();
                  lastSelected.current = event.target.dataset.blockId;
                  onSelect(`block:${event.target.dataset.blockId}`);
                  referenceImage(event.target.dataset.blockId);
                } else remember();
              }}
              onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; commit(); }}
              onPointerDown={resizeImage} onDragStart={event => { const figure = event.target.closest('.editor-image'); if (!figure || readOnly) { event.preventDefault(); return; } event.dataTransfer.setData('application/x-weave-block', figure.dataset.blockId); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDrop(null); }}/>
          </div>
        </div>{footer}</div>
      </div>
    </div>
  </div>;
}
