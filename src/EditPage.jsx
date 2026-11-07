import React, { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, History, ImagePlus, LayoutGrid, Plus, PanelRightClose, PanelRightOpen, Undo2, Redo2, RefreshCw, Save, X } from "lucide-react";
import { uid } from "./core";
import { bodyCharCount, bodyLengthStatus, TARGET_LENGTHS } from "./creation.js";
import { AISettingsButton } from "./AISettingsButton";
import { ArticleEditor } from "./ArticleEditor";
import { AIEditPanel, useAIEdit } from "./AIEditPanel";
import { ImageLinkInput } from "./ImageLinkInput";
import { clearArticleStyles, layoutSignature } from "./layout-design.js";
import { saveAsset } from "./storage";
import { ArticleHistory } from "./ArticleHistory";
import { absoluteUrl, uploadAsset } from "./api.js";
import { ConfirmDialog, Modal } from "./Modal.jsx";
import { TemplateThumb } from "./TemplateThumb";
import { TemplateLibrary } from "./TemplateLibrary";

const LayoutDesigner = React.lazy(() => import('./LayoutDesigner').then(module => ({ default: module.LayoutDesigner })));
const isImageBlock = block => block.type === "image" || block.type === "imageCard";

export function EditPage({
  onHistorySaved,
  onHistoryOpened,
  copyFailure,
  savedSnapshot,
  onSnapshotSaved,
  onSnapshotCleared,
  onRegenerate,
  aiConfigured,
  aiRequest,
  openService,
  onReturnToCreate,
  navigating,
  article,
  setArticle,
  template,
  selected,
  setSelected,
  recs,
  assets,
  setAssets,
  canvasWidth,
  setCanvasWidth,
  copy,
  clear,
  saved,
  setModal,
  modal,
  setToast,
}) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [savingHistory, setSavingHistory] = useState(false);
  const [library, setLibrary] = useState(false);
  const [libraryOriginal, setLibraryOriginal] = useState(selected);
  const [layoutTrial, setLayoutTrial] = useState(null);
  const [layoutReset, setLayoutReset] = useState(0);
  const [sideTab, setSideTab] = useState('templates');
  const [toolsOpen, setToolsOpen] = useState(true);
  const closeModal = () => setModal(null);
  const resetLayoutTrial = () => { setLayoutTrial(null); setLayoutReset(value => value + 1); };
  const applyLayoutTrial = () => {
    const candidate = layoutTrial;
    if (!candidate) return;
    if (layoutSignature(article) !== candidate.signature) {
      resetLayoutTrial();
      setToast('正文已变化，请重新设计');
      return;
    }
    setArticle(current => layoutSignature(current) === candidate.signature
      ? { ...clearArticleStyles(current), layoutDesign: candidate.design, updatedAt: new Date().toISOString() }
      : current);
    resetLayoutTrial();
    setToast('排版已应用，可撤销');
  };
  const openLibrary = () => {
    resetLayoutTrial();
    setLibraryOriginal(selected);
    setLibrary(true);
  };
  const cancelLibrary = () => {
    setSelected(libraryOriginal);
    setLibrary(false);
  };
  const snapshot = savedSnapshot;
  const [regenerating, setRegenerating] = useState(false);
  const aiEditor = useAIEdit({ article, setArticle, assets, aiRequest, disabled: !aiConfigured || library || regenerating || Boolean(layoutTrial), onApplied: resetLayoutTrial, onCandidate: () => { if (window.matchMedia('(max-width: 760px)').matches) setToolsOpen(false); }, onRegisterAsset: asset => registerImageAsset(asset), setToast });
  const history = useRef([]);
  const future = useRef([]);
  const [historySize, setHistorySize] = useState(0);
  const [futureSize, setFutureSize] = useState(0);
  const lastArticle = useRef(article);
  const historyMove = useRef(false);
  const [account, setAccount] = useState(
    article.settings?.accountName || "我的公众号",
  );
  const bodyLength = TARGET_LENGTHS.includes(article.settings?.targetLength)
    ? bodyLengthStatus(article.blocks, article.settings.targetLength) : null;
  const imageInput = useRef();
  const [imageUploads, setImageUploads] = useState(0);
  const [insertAt, setInsertAt] = useState(0);
  const [replaceBlockId, setReplaceBlockId] = useState(null);
  const [imageSource, setImageSource] = useState('local');
  useEffect(() => { if (modal === 'gallery') setImageSource('local'); }, [modal]);
  const undo = () => {
    const prev = history.current.pop();
    if (!prev) return;
    future.current.push(article);
    setFutureSize(future.current.length);
    setHistorySize(history.current.length);
    historyMove.current = true;
    setArticle(prev);
    setSelected(prev.templateId);
  };
  const redo = () => {
    const next = future.current.pop();
    if (!next) return;
    history.current.push(article);
    setHistorySize(history.current.length);
    setFutureSize(future.current.length);
    historyMove.current = true;
    setArticle(next);
    setSelected(next.templateId);
  };
  useEffect(() => {
    const key = (e) => {
      if (historyOpen) return;
      if (
        !(e.ctrlKey || e.metaKey) ||
        e.key.toLowerCase() !== "z" ||
        ["INPUT", "TEXTAREA"].includes(e.target.tagName)
      )
        return;
      if (editorPane.current?.querySelector('[aria-readonly="true"]')) return;
      e.preventDefault();
      e.shiftKey ? redo() : undo();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [article, historyOpen]);
  useEffect(() => {
    if (lastArticle.current !== article) {
      if (!historyMove.current) {
        history.current.push(lastArticle.current);
        if (history.current.length > 100) history.current.shift();
        future.current = [];
        setHistorySize(history.current.length);
        setFutureSize(0);
      }
      lastArticle.current = article;
      historyMove.current = false;
    }
  }, [article]);
  const editorPane = useRef();
  const activeKeyRef = useRef(null);
  const [activeKey, setActiveKey] = useState(null);
  const locateContent = (key, source) => {
    activeKeyRef.current = key;
    setActiveKey(key);
    if (source === 'editor') return;
    if (window.matchMedia('(max-width: 760px)').matches) setToolsOpen(false);
    requestAnimationFrame(() => {
      const pane = editorPane.current?.querySelector('.canvas-scroll');
      const target = pane?.querySelector(`[data-editor-key="${CSS.escape(key)}"]`);
      if (target) pane.scrollTo({ top: Math.max(0, pane.scrollTop + target.getBoundingClientRect().top - pane.getBoundingClientRect().top - 40), behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    });
  };
  const locateFromCanvas = event => {
    const key = event.target.closest('[data-editor-key]')?.dataset.editorKey;
    if (key) locateContent(key, 'editor');
  };
  const aiPreview = !library && !layoutTrial ? aiEditor.previewArticle : null;
  const canvasArticle = useMemo(() => aiPreview || (layoutTrial?.signature === layoutSignature(article)
    ? { ...clearArticleStyles(article), layoutDesign: layoutTrial.design } : article), [article, aiPreview, layoutTrial]);
  const canvasReadOnly = Boolean(navigating || aiPreview || layoutTrial || library || regenerating || aiEditor.busy === 'checking');
  const chooseTemplate = (id) => {
    resetLayoutTrial();
    if (!library) {
      setLibraryOriginal(article.templateId);
      setSelected(id);
      setLibrary(true);
      return;
    }
    setSelected(id);
  };
  const addBlock = (type) => {
    if (article.blocks.length >= 120) { setToast("段落数量已达上限"); return; }
    const id = uid("b");
    const next =
      type === "heading"
        ? { id, type, level: 1, text: "新的章节" }
        : type === "divider"
          ? { id, type }
          : type === "quote"
            ? { id, type, runs: [{ text: "引用内容" }] }
            : type === "list"
              ? { id, type, ordered: false, items: [[{ text: "新的条目" }]] }
            : { id, type, runs: [{ text: "写下新的内容" }] };
    setArticle((a) => {
      const blocks = [...a.blocks];
      blocks.splice(Math.min(insertAt, blocks.length), 0, next);
      return { ...a, blocks };
    });
    locateContent(`block:${id}`);
  };
  const registerImageAsset = async asset => {
    const stored = { ...asset, previewUrl: URL.createObjectURL(asset.blob) };
    try { await saveAsset(stored, stored.blob); }
    catch (error) { URL.revokeObjectURL(stored.previewUrl); throw error; }
    setAssets(current => new Map(current).set(stored.id, stored));
  };
  const placeImageAsset = (asset, index, blockId, beforeId) => {
    const current = lastArticle.current;
    if (!current || current.id !== article.id) throw new Error('文章已切换，请重新插入图片');
    if (!blockId && current.blocks.length >= 120) throw new Error('段落数量已达上限，请先合并部分内容');
    if (!blockId && current.blocks.filter(isImageBlock).length >= 10) throw new Error('最多添加 10 张图片');
    if (blockId && !current.blocks.some(block => block.id === blockId)) throw new Error('原图片已删除，请重新插入');
    const id = blockId || uid('b');
    setArticle(a => {
      if (!a || a.id !== article.id) return a;
      if (blockId) return { ...a, blocks: a.blocks.map(block => block.id === blockId ? { ...block, assetId: asset.id } : block), updatedAt: new Date().toISOString() };
      if (a.blocks.length >= 120 || a.blocks.filter(isImageBlock).length >= 10) return a;
      const blocks = [...a.blocks];
      const anchor = beforeId === null ? blocks.length : blocks.findIndex(block => block.id === beforeId);
      blocks.splice(anchor >= 0 ? anchor : Math.min(index, blocks.length), 0, { id, type: 'imageCard', assetId: asset.id, caption: '' });
      return { ...a, blocks, updatedAt: new Date().toISOString() };
    });
    setReplaceBlockId(null);
    return id;
  };
  const uploadImage = async (file, index = article.blocks.length, blockId = null, beforeId = undefined) => {
    if (!file) return;
    if (!blockId && article.blocks.length >= 120) { setToast("段落数量已达上限，请先合并部分内容"); return; }
    if (!blockId && article.blocks.filter(isImageBlock).length >= 10) { setToast("最多添加 10 张图片"); return; }
    setImageUploads(count => count + 1);
    try {
      const uploaded = await uploadAsset(file);
      const asset = { ...uploaded, url: absoluteUrl(uploaded.url), blob: file };
      await registerImageAsset(asset);
      return placeImageAsset(asset, index, blockId, beforeId);
    } catch (e) {
      setToast(e.message || "图片上传失败");
    } finally {
      setImageUploads(count => count - 1);
    }
  };
  const requestRegenerate = async () => {
    if (regenerating || canvasReadOnly) return;
    const previous = article;
    setRegenerating(true);
    try {
      const result = await onRegenerate();
      if (!result?.pending) {
        onSnapshotSaved?.(previous);
        setToast(result?.ignoredImages ? `${result.ignoredImages} 张 Markdown 图片未导入，请在编辑器中插入原图` : "文章已重新生成");
      }
    } catch (e) {
      setToast(e.message || "重新生成失败");
    } finally {
      setRegenerating(false);
    }
  };
  const saveHistory = async () => {
    if (savingHistory || canvasReadOnly) return;
    setSavingHistory(true);
    try {
      await onHistorySaved();
      setToast("已保存到历史记录");
    } catch { setToast("历史记录保存失败，请检查浏览器存储空间"); }
    finally { setSavingHistory(false); }
  };
  return (
    <div className="edit-shell">
      <header className="edit-topbar">
        <button className="back-button" disabled={navigating || imageUploads > 0 || regenerating || savingHistory || Boolean(aiEditor.busy)} onClick={onReturnToCreate}>
          <ArrowLeft size={17} />
          <span>{navigating ? "保存中…" : "新建文章"}</span>
        </button>
        <div className="edit-brand">
          <span className="mark small">W</span>
          <strong>Weave</strong>
          <span className="draft-status" title={saved ? `保存于 ${saved}` : undefined}>
            <i></i>
            {saved ? "已保存" : "保存中"}
          </span>
        </div>
        <div className="top-actions">
          <div className="history-tools">
            <button onClick={undo} disabled={!historySize || canvasReadOnly} title="撤销 Ctrl+Z" aria-label="撤销"><Undo2 size={16}/></button>
            <button onClick={redo} disabled={!futureSize || canvasReadOnly} title="重做 Ctrl+Shift+Z" aria-label="重做"><Redo2 size={16}/></button>
          </div>
          <button className="icon-action tools-toggle" aria-label={toolsOpen ? '折叠工具面板' : '展开工具面板'} aria-controls="workspace-tools" aria-expanded={toolsOpen} title={toolsOpen ? '折叠工具面板' : '展开工具面板'} onClick={() => setToolsOpen(value => !value)}>{toolsOpen ? <PanelRightClose size={17}/> : <PanelRightOpen size={17}/>}</button>
          <AISettingsButton configured={aiConfigured} onClick={openService} />
          <button className="ghost-action" disabled={navigating || regenerating || imageUploads > 0 || savingHistory || Boolean(aiEditor.busy)} onClick={() => setModal("clear")}>
            清空草稿
          </button>
          <button className="ghost-action article-history-action" onClick={() => setHistoryOpen(true)} disabled={canvasReadOnly || Boolean(aiEditor.busy) || savingHistory} title="历史记录" aria-label="历史记录">
            <History size={16}/><span>历史记录</span>
          </button>
          <button className="ghost-action article-history-action" onClick={saveHistory} disabled={canvasReadOnly || savingHistory || imageUploads > 0} title="保存历史" aria-label="保存历史">
            <Save size={16}/><span>{savingHistory ? "保存中" : "保存历史"}</span>
          </button>
          <button className="publish-action" disabled={Boolean(layoutTrial || aiPreview)} title={layoutTrial || aiPreview ? '应用当前方案后再复制' : undefined} onClick={() => copy()}>
            <Copy size={16} />
            复制排版
          </button>
        </div>
      </header>
      {historyOpen && <ArticleHistory onClose={() => setHistoryOpen(false)} onOpen={async record => { await onHistoryOpened(record); setHistoryOpen(false); }} setToast={setToast}/>}
      <div className={`edit-workspace${toolsOpen ? ' tools-open' : ''}`}>
        <main className="canvas-pane" ref={editorPane} onClickCapture={locateFromCanvas} onFocusCapture={locateFromCanvas}>
          <div className="canvas-toolbar">
            <div className="canvas-heading"><strong>{canvasArticle.layoutDesign?.name || template.name}</strong><span>{canvasReadOnly ? '方案预览' : '直接编辑'}</span></div>
            <div className="width-switch" role="group" aria-label="画布宽度">
              {[320, 375, 414, 720].map(width => <button key={width} aria-pressed={canvasWidth === width} className={canvasWidth === width ? 'on' : ''} onClick={() => setCanvasWidth(width)}>{width === 720 ? '宽屏' : width}</button>)}
            </div>
            <div className="writing-status" aria-label="当前文章创作设置"><span>正文 {bodyLength?.actual ?? bodyCharCount(article.blocks)} 字</span><span className={article.title.length > 64 ? 'error' : ''}>标题 {article.title.length}/64</span></div>
          </div>
          {aiEditor.candidate && !aiEditor.problem && <div className="ai-edit-preview-bar"><span>{aiPreview ? `${aiEditor.changes.length} 处改动 · 应用后可编辑` : '原稿'}</span><div><button className="text-link" disabled={Boolean(aiEditor.busy)} onClick={aiEditor.discard}>取消</button><button className="text-link" onClick={() => aiEditor.setShowCandidate(value => !value)}>{aiEditor.showCandidate ? '看原稿' : '看方案'}</button><button className="preview-apply" disabled={Boolean(aiEditor.busy || aiEditor.problem)} onClick={aiEditor.apply}><Check size={13}/>应用</button></div></div>}
          {layoutTrial && <div className="ai-edit-preview-bar layout-preview-bar"><span>{layoutTrial.design.name} · 应用后可编辑</span><div><button className="text-link" onClick={resetLayoutTrial}>取消</button><button className="preview-apply" onClick={applyLayoutTrial}><Check size={13}/>应用排版</button></div></div>}
          {imageUploads > 0 && <div className="editor-uploading" role="status"><RefreshCw size={14} className="spin"/>上传图片中…</div>}
          <ArticleEditor
            article={article} displayArticle={canvasArticle === article ? undefined : canvasArticle} readOnly={canvasReadOnly} width={canvasWidth} changes={aiPreview ? aiEditor.changes : []}
            setArticle={setArticle} template={template} assets={assets} activeKey={activeKey}
            onSelect={key => locateContent(key, 'editor')} onReference={aiEditor.addReference} onUpload={uploadImage} onRegisterAsset={registerImageAsset}
            onGallery={(index, blockId = null) => { setInsertAt(index); setReplaceBlockId(blockId); setModal('gallery'); }} setToast={setToast}
            header={<div className="canvas-account"><input maxLength={64} value={account} disabled={canvasReadOnly} onChange={event => { setAccount(event.target.value); setArticle(a => ({ ...a, settings: { ...a.settings, accountName: event.target.value } })); }} aria-label="公众号名称"/><span>{new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })}</span></div>}
            footer={<div className="canvas-footer" style={{ width: canvasWidth }}>
              <button className="add-block" disabled={canvasReadOnly} onClick={() => { setInsertAt(article.blocks.length); setModal('add'); }}><Plus size={15}/>添加内容</button>
              <div className="article-end-actions"><button className="text-link" disabled={!aiConfigured || regenerating || canvasReadOnly} onClick={requestRegenerate}><RefreshCw size={14} className={regenerating ? 'spin' : ''}/>重新生成</button>{snapshot && <button className="text-link" disabled={canvasReadOnly} onClick={() => { setArticle(snapshot); setSelected(snapshot.templateId); onSnapshotCleared?.(); }}>撤销重新生成</button>}</div>
            </div>}
          />
        </main>
        <aside id="workspace-tools" hidden={!toolsOpen} className={`template-pane${sideTab === 'ai' ? ' ai-edit-pane' : ''}`}>
          <div className="tools-heading"><span>排版与 AI</span><button className="asset-remove" aria-label="关闭工具面板" onClick={() => setToolsOpen(false)}><X size={16}/></button></div>
          <div className="side-panel-tabs" role="tablist" aria-label="右侧工具">
            <button id="templates-tab" role="tab" aria-selected={sideTab === 'templates'} aria-controls="templates-panel" onClick={() => setSideTab('templates')}>模板</button>
            <button id="ai-edit-tab" role="tab" aria-selected={sideTab === 'ai'} aria-controls="ai-edit-panel" onClick={() => setSideTab('ai')}>AI 修改{aiEditor.references.length > 0 && <span>{aiEditor.references.length}</span>}</button>
          </div>
          <div className="side-panel-content" id="templates-panel" role="tabpanel" aria-labelledby="templates-tab" hidden={sideTab !== 'templates'}>
          <React.Suspense fallback={null}><LayoutDesigner key={article.id} article={article} setArticle={setArticle} aiRequest={aiRequest} onTrial={candidate => { setLayoutTrial(candidate); if (candidate && window.matchMedia('(max-width: 760px)').matches) setToolsOpen(false); }} resetKey={layoutReset} disabled={!aiConfigured || library || regenerating || Boolean(aiEditor.busy)} setToast={setToast} /></React.Suspense>
          <div className="recommend-label">
            <span>推荐模板</span>
          </div>
          <div className="recommend-list">
            {recs.map((t) => (
              <button
                key={t.id}
                onClick={() => chooseTemplate(t.id)}
                aria-pressed={selected === t.id}
                className={
                  selected === t.id ? "recommend-item active" : "recommend-item"
                }
              >
                <TemplateThumb article={article} template={t} assets={assets} />
                <span className="recommend-copy">
                  <strong>{t.name}</strong>
                  <span className="template-style-text">{t.styleTags.join(" · ")}</span>

                </span>
                {selected === t.id && <span className="selected-tick">✓</span>}
              </button>
            ))}
          </div>
          <button className="all-templates" onClick={openLibrary}>
            <LayoutGrid size={16} />
            全部模板
            <ArrowRight size={15} />
          </button>
          <div className="template-current"><span>当前</span><strong>{article.layoutDesign?.name || template.name}</strong></div>
          </div>
          <div className="side-panel-content ai-edit-slot" id="ai-edit-panel" role="tabpanel" aria-labelledby="ai-edit-tab" hidden={sideTab !== 'ai'}>
            <AIEditPanel editor={aiEditor} article={article} assets={assets} disabled={!aiConfigured || library || regenerating || Boolean(layoutTrial)} onLocate={key => locateContent(key)}/>
          </div>
        </aside>
      </div>
      {library && <TemplateLibrary
        article={article}
        template={template}
        assets={assets}
        recs={recs}
        selected={selected}
        chooseTemplate={chooseTemplate}
        onCancel={cancelLibrary}
        onApply={() => {
          setArticle(a => ({ ...a, templateId: selected, layoutDesign: undefined, html: undefined, updatedAt: new Date().toISOString() }));
          setLibrary(false);
        }}
      />}
      {modal === "gallery" && <Modal onClose={closeModal}>
        <h2>{replaceBlockId ? "替换图片" : "插入图片"}</h2>
        <div className="image-source-tabs" role="tablist" aria-label="图片来源">
          <button role="tab" aria-selected={imageSource === 'local'} onClick={() => setImageSource('local')}>素材库</button>
          <button role="tab" aria-selected={imageSource === 'link'} onClick={() => setImageSource('link')}>图片链接</button>
        </div>
        {imageSource === 'link' ? <ImageLinkInput replacing={Boolean(replaceBlockId)} onInsert={async asset => {
          await registerImageAsset(asset);
          return placeImageAsset(asset, insertAt, replaceBlockId);
        }} onDone={id => {
          setModal(null);
          locateContent(`block:${id}`);
        }}/> : <>
          <div className="asset-gallery">
            {[...assets.values()].map(asset => (
              <button key={asset.id} onClick={() => {
                try {
                  const id = placeImageAsset(asset, insertAt, replaceBlockId);
                  setModal(null);
                  locateContent(`block:${id}`);
                } catch (error) { setToast(error.message); }
              }}>
                <img src={asset.previewUrl || asset.url} alt="" />
                <span>{asset.filename || asset.id}</span>
              </button>
            ))}
            {assets.size === 0 && <div className="gallery-empty"><ImagePlus size={28}/><p>添加第一张图片</p><small>支持拖入编辑器或上传文件</small></div>}
          </div>
          <button className="text-link" onClick={() => imageInput.current?.click()}>
            <ImagePlus size={15} />
            上传图片
          </button>
          <input ref={imageInput} hidden type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
            const file = event.target.files?.[0];
            const blockId = replaceBlockId;
            event.target.value = "";
            if (!file) return;
            setModal(null);
            uploadImage(file, insertAt, blockId).then(id => { if (id) locateContent(`block:${id}`); });
          }}/>
        </>}
        <div className="modal-buttons">
          <button className="ghost-action" onClick={closeModal}>取消</button>
        </div>
      </Modal>}
      {modal === "add" && <Modal onClose={closeModal}>
        <h2>添加内容</h2>
        <div className="add-options">
          {[["paragraph", "正文段落"], ["heading", "一级标题"], ["callout", "提示框"], ["quote", "引用"], ["list", "要点列表"], ["divider", "分隔线"]].map(([type, label]) => (
            <button key={type} onClick={() => { addBlock(type); setModal(null); }}>
              {label}
              <ArrowRight size={15} />
            </button>
          ))}
        </div>
      </Modal>}
      {modal === "clear" && <ConfirmDialog eyebrow="清空草稿" title="删除当前文章草稿？" onClose={closeModal} confirmLabel="清空草稿" confirmClassName="danger-action" confirmDisabled={navigating} onConfirm={clear}/>}
      {modal === "copied" && <ConfirmDialog eyebrow="已复制" eyebrowClassName="success-eyebrow" title="HTML 排版已复制" onClose={closeModal} cancelLabel="关闭" confirmLabel={<><Copy size={14} />重新复制</>} onConfirm={() => { setModal(null); copy(true); }}>
        <p>请在 135 编辑器或公众号后台粘贴，并检查版式与图片。</p>
        <ol>
          <li>打开 135 编辑器或公众号图文编辑器</li>
          <li>在正文区域按 Ctrl+V 粘贴内容</li>
          <li>检查版式与图片后保存</li>
        </ol>
        <div className="image-checks">
          {article.blocks.filter(isImageBlock).map(block => {
            const asset = assets.get(block.assetId);
            const broken = asset?.pasteStatus === "broken";
            return <div key={block.id}>
              <span>{block.caption || "文章图片"}</span>
              {asset?.previewUrl && <img className="copy-image-thumb" src={asset.previewUrl} alt="" />}
              <small>{broken ? "资源已过期，需重新上传" : "需手动检查"}</small>
              {broken && <button className="text-link" onClick={() => {
                if (asset.blob) uploadImage(asset.blob, article.blocks.findIndex(item => item.id === block.id), block.id);
              }}>重新上传</button>}
              <a href={asset?.previewUrl || asset?.url || "#"} download>下载原图</a>
            </div>;
          })}
        </div>
      </ConfirmDialog>}
      {modal === "long-title" && <ConfirmDialog eyebrow="文章标题" title="标题超过 64 个字符" onClose={closeModal} cancelLabel="继续编辑" confirmLabel="仍然复制" onConfirm={() => copy(true)}>
        <p>可以返回缩短标题，或继续复制。</p>
      </ConfirmDialog>}
      {modal === "copy-error" && <ConfirmDialog eyebrow="复制未完成" title={copyFailure === "permission" ? "剪贴板权限被拒绝" : "HTML 排版未能复制"} onClose={closeModal} cancelLabel="关闭" confirmLabel="重新复制 HTML" onConfirm={() => copy(true)}>
        <p>{copyFailure === "permission" ? "请允许本页访问剪贴板后重新复制。" : "请重新复制；如果仍然失败，请使用 Chrome 或 Edge 桌面版重试。"}</p>
      </ConfirmDialog>}
    </div>
  );
}
