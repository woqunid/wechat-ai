import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AlignCenter, AlignJustify, AlignLeft, AlignRight, Bold, Eraser, Highlighter, ImagePlus, IndentIncrease, Trash2, Underline } from 'lucide-react';
import { blockText, uid } from './core.js';
import { imageLink, readImageLink } from './image-assets.js';
import { bookmarkRange, clipboardBlocks, editorBookmark, editorHtml, readEditorBlocks, restoreBookmark } from './editor-dom.js';

const imageBlock = block => block?.type === 'image' || block?.type === 'imageCard';
const plainRuns = runs => runs.map(run => ({ text: run.text }));

export function ArticleEditor({ article, setArticle, template, assets, activeKey, onSelect, onUpload, onRegisterAsset, onGallery, setToast }) {
  const canvas = useRef();
  const sheet = useRef();
  const bookmark = useRef(null);
  const localBlocks = useRef(null);
  const visualSource = useRef(null);
  const pendingRestore = useRef(false);
  const composing = useRef(false);
  const mutating = useRef(false);
  const draggingText = useRef(false);
  const lastSelected = useRef(null);
  const [selection, setSelection] = useState(null);
  const [drop, setDrop] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const pendingImages = useRef(new Map());
  const latestArticle = useRef(article);
  latestArticle.current = article;
  const selectedId = activeKey?.startsWith('block:') ? activeKey.slice(6) : activeKey ? null : selection?.startId;
  const current = article.blocks.find(block => block.id === selectedId) || (!activeKey ? article.blocks[0] : undefined);
  const chosen = bookmark.current && current && bookmark.current.startId === current.id ? bookmark.current.ids.filter(id => article.blocks.some(block => block.id === id)) : [];
  const selectedIds = chosen.length ? chosen : current ? [current.id] : [];
  const currentStyle = current?.style || {};

  const remember = () => {
    if (document.activeElement?.tagName === 'FIGURE') return;
    const next = editorBookmark(canvas.current);
    if (!next) return;
    bookmark.current = next;
    setSelection(next);
    if (lastSelected.current !== next.startId) {
      lastSelected.current = next.startId;
      onSelect(`block:${next.startId}`);
    }
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
    const id = activeKey?.startsWith('block:') ? activeKey.slice(6) : null;
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
    if (localBlocks.current === article.blocks && visualSource.current?.template === template && visualSource.current?.assets === assets) return;
    const focused = root.contains(document.activeElement);
    const saved = bookmark.current;
    root.innerHTML = editorHtml(article.blocks.length ? article.blocks : [{ id: uid('b'), type: 'paragraph', runs: [{ text: '' }] }], assets, template);
    localBlocks.current = article.blocks;
    visualSource.current = { template, assets };
    const sameTarget = !activeKey || activeKey === `block:${saved?.startId}`;
    if ((focused || pendingRestore.current) && saved && sameTarget) restoreBookmark(root, saved);
    else if (focused && !sameTarget) document.activeElement?.blur();
    pendingRestore.current = false;
  }, [article.blocks, assets, template]);

  useLayoutEffect(() => {
    canvas.current?.querySelector('.is-linked')?.classList.remove('is-linked');
    if (activeKey) canvas.current?.querySelector(`[data-editor-key="${CSS.escape(activeKey)}"]`)?.classList.add('is-linked');
  }, [activeKey, article.blocks, template, assets]);

  const publish = (blocks, local = false) => {
    if (!blocks.length) blocks = [{ id: uid('b'), type: 'paragraph', runs: [{ text: '' }] }];
    if (blocks.length > 120) { setToast('正文最多保留 120 个段落，请先合并部分内容'); return false; }
    if (blocks.filter(imageBlock).length > 10) { setToast('正文最多添加 10 张图片'); return false; }
    localBlocks.current = local ? blocks : null;
    pendingRestore.current = !local;
    setArticle(previous => ({ ...previous, blocks, updatedAt: new Date().toISOString() }));
    return true;
  };
  const commit = () => {
    if (composing.current || mutating.current) return;
    const blocks = readEditorBlocks(canvas.current, article.blocks, assets);
    remember();
    const structuralChange = blocks.length !== article.blocks.length || blocks.some((block, index) => block.id !== article.blocks[index]?.id || block.type !== article.blocks[index]?.type);
    if (!publish(blocks, !structuralChange)) {
      canvas.current.innerHTML = editorHtml(article.blocks, assets, template);
      restoreBookmark(canvas.current, bookmark.current);
    }
  };
  const execute = (name, value) => {
    mutating.current = true;
    try { return document.execCommand(name, false, value); }
    finally { mutating.current = false; }
  };
  const command = (name, value) => {
    if (!restoreBookmark(canvas.current, bookmark.current)) { setToast('先在正文中选择需要修改的文字'); return; }
    document.execCommand('styleWithCSS', false, true);
    execute(name, value);
    commit();
  };
  const patchStyle = patch => {
    publish(article.blocks.map(block => selectedIds.includes(block.id) ? { ...block, style: { ...block.style, ...patch } } : block));
  };
  const resetStyle = () => {
    publish(article.blocks.map(block => {
      if (!selectedIds.includes(block.id)) return block;
      const { style, ...next } = block;
      if (next.runs) next.runs = plainRuns(next.runs);
      if (next.items) next.items = next.items.map(plainRuns);
      return next;
    }));
  };
  const changeType = value => {
    publish(article.blocks.map(block => {
      if (!selectedIds.includes(block.id) || imageBlock(block)) return block;
      const runs = block.runs || (block.type === 'heading' ? [{ text: block.text }] : block.items?.flatMap((item, i) => i ? [{ text: '\n' }, ...item] : item)) || [{ text: '' }];
      const base = { id: block.id, ...(block.style ? { style: block.style } : {}) };
      if (value.startsWith('heading')) return { ...base, type: 'heading', level: value === 'heading1' ? 1 : 2, text: runs.map(run => run.text).join(''), runs };
      if (value === 'list' || value === 'ordered') return { ...base, type: 'list', ordered: value === 'ordered', items: block.items || [runs] };
      if (value === 'divider') return { ...base, type: 'divider' };
      return { ...base, type: value, runs, ...(value === 'quote' ? { cite: block.cite || '' } : {}) };
    }));
  };
  const splitParagraph = event => {
    if (document.activeElement?.tagName === 'FIGURE' && ['Backspace', 'Delete'].includes(event.key)) {
      event.preventDefault();
      const id = document.activeElement.dataset.blockId;
      publish(article.blocks.filter(block => block.id !== id));
      return;
    }
    if ((event.ctrlKey || event.metaKey) && ['b', 'u'].includes(event.key.toLowerCase())) {
      event.preventDefault();
      command(event.key.toLowerCase() === 'b' ? 'bold' : 'underline');
      return;
    }
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing.current) return;
    const saved = editorBookmark(canvas.current);
    const range = bookmarkRange(canvas.current, saved);
    if (!range) return;
    const node = canvas.current.querySelector(`[data-block-id="${CSS.escape(saved.startId)}"]`);
    if (!node || !['P', 'H2', 'H3'].includes(node.tagName)) return;
    if (article.blocks.length >= 120) { event.preventDefault(); setToast('段落数量已达上限'); return; }
    event.preventDefault();
    range.deleteContents();
    const tail = range.cloneRange();
    tail.selectNodeContents(node);
    tail.setStart(range.startContainer, range.startOffset);
    const next = document.createElement('p');
    next.dataset.blockId = uid('b');
    if (node.tagName === 'P') {
      if (node.dataset.blockStyle) next.dataset.blockStyle = node.dataset.blockStyle;
      next.style.cssText = node.style.cssText;
    }
    next.appendChild(tail.extractContents());
    if (!next.hasChildNodes()) next.appendChild(document.createElement('br'));
    if (!node.hasChildNodes()) node.appendChild(document.createElement('br'));
    node.after(next);
    range.selectNodeContents(next);
    range.collapse(true);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    commit();
  };
  const insertIndex = () => {
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
  const paste = event => {
    event.preventDefault();
    if (event.clipboardData.files.length) { uploadFiles(event.clipboardData.files, insertIndex()); return; }
    const text = event.clipboardData.getData('text/plain').trim();
    const url = imageLink(text);
    if (url) { remember(); pasteImageLink(url, text); return; }
    const blocks = clipboardBlocks(event.clipboardData.getData('text/html'), event.clipboardData.getData('text/plain'), assets);
    remember();
    const replacing = bookmark.current?.collapsed ? 0 : Math.max(0, (bookmark.current?.ids.length || 1) - 1);
    if (article.blocks.length + blocks.length - 1 - replacing > 120) { setToast('粘贴后段落过多，请分批粘贴'); return; }
    if (restoreBookmark(canvas.current, bookmark.current)) {
      let html = editorHtml(blocks, assets, template);
      if (blocks.length === 1 && blocks[0].type === 'paragraph') html = html.replace(/^<p\b[^>]*>/, '').replace(/<\/p>$/, '');
      execute('insertHTML', html);
      commit();
    }
  };
  const dropPosition = event => {
    const element = event.target.closest('[data-block-id]');
    if (!element || !canvas.current.contains(element)) return { index: article.blocks.length, top: canvas.current.offsetHeight };
    const index = article.blocks.findIndex(block => block.id === element.dataset.blockId);
    const rect = element.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    return { index: Math.max(0, index) + (after ? 1 : 0), top: rect.top - sheet.current.getBoundingClientRect().top + (after ? rect.height : 0) };
  };
  const dragOver = event => {
    if (!Array.from(event.dataTransfer.types).some(type => ['Files', 'application/x-weave-block', 'application/x-weave-asset'].includes(type))) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = event.dataTransfer.types.includes('application/x-weave-block') ? 'move' : 'copy';
    setDrop(dropPosition(event));
  };
  const dropImage = event => {
    const id = event.dataTransfer.getData('application/x-weave-block');
    const assetId = event.dataTransfer.getData('application/x-weave-asset');
    if (!id && !assetId && !event.dataTransfer.files.length) {
      if (draggingText.current) return;
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
    if (!event.target.hasAttribute('data-resize-handle')) return;
    event.preventDefault(); event.stopPropagation();
    const figure = event.target.closest('figure');
    const id = figure.dataset.blockId;
    const startX = event.clientX;
    const startWidth = figure.getBoundingClientRect().width;
    const available = canvas.current.clientWidth;
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
    <div className="document-toolbar" role="toolbar" aria-label="文字与段落排版">
      <div className="document-toolbar-row">
        <select aria-label="段落类型" value={imageBlock(current) ? 'image' : valueType} onChange={event => changeType(event.target.value)} disabled={imageBlock(current)}>
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
    </div>
    {imageBlock(current) && <div className="editor-image-controls"><label>图片宽度 <input aria-label="图片宽度" type="range" min="20" max="100" step="5" value={currentStyle.imageWidth || 100} onChange={event => patchStyle({ imageWidth: Number(event.target.value) })}/><span>{currentStyle.imageWidth || 100}%</span></label><div>{[['left','靠左'],['center','居中'],['right','靠右']].map(([align,label]) => <button key={align} aria-pressed={(currentStyle.align || 'left') === align} onClick={() => patchStyle({ align })}>{label}</button>)}<button onClick={() => onGallery(article.blocks.findIndex(block => block.id === current.id), current.id)}>替换图片</button><button title="删除当前图片，可撤销" aria-label="删除图片" onClick={() => publish(article.blocks.filter(block => block.id !== current.id))}><Trash2 size={14}/></button></div></div>}
    {uploading && <p className="editor-uploading" role="status">图片上传中…</p>}
    {importCount > 0 && <p className="editor-uploading" role="status">正在识别 {importCount} 个图片链接，链接文字已保留…</p>}
    <div className="document-sheet" ref={sheet} onDragOver={dragOver} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDrop(null); }} onDrop={dropImage}>
      {drop && <div className="editor-drop-line" style={{ top: drop.top }} aria-hidden="true"/>}
      <div ref={canvas} className="document-canvas" role="textbox" aria-label="文章正文，支持连续编辑和文字排版" aria-multiline="true" contentEditable suppressContentEditableWarning spellCheck={false} style={{ '--editor-primary': template.tokens.primary, '--editor-tint': template.tokens.tint, '--editor-line-height': template.tokens.lineHeight, '--editor-paragraph-gap': `${template.tokens.paraGap}px` }}
        onInput={commit} onPaste={paste} onKeyDown={splitParagraph} onMouseUp={remember} onKeyUp={remember} onFocus={event => {
          if (event.target.tagName === 'FIGURE') {
            bookmark.current = null;
            setSelection(null);
            window.getSelection()?.removeAllRanges();
            lastSelected.current = event.target.dataset.blockId;
            onSelect(`block:${event.target.dataset.blockId}`);
          } else remember();
        }}
        onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; commit(); }}
        onPointerDown={resizeImage} onDragStart={event => { const figure = event.target.closest('figure[data-block-id]'); draggingText.current = !figure; if (figure) { event.dataTransfer.setData('application/x-weave-block', figure.dataset.blockId); event.dataTransfer.effectAllowed = 'move'; } }} onDragEnd={() => { draggingText.current = false; setDrop(null); }}/>
    </div>
    <p className="editor-help">回车换段 · Shift+回车换行 · 拖动图片可调整位置，拖动图片角落可缩放</p>
  </div>;
}
