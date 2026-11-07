import { useState } from "react";
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, FileText, History, ImagePlus, Plus, RefreshCw, Settings2, Sparkles, Upload, X } from "lucide-react";
import { CREATION_MODES, TARGET_LENGTHS, WRITING_TONES } from "./creation.js";
import { AISettingsButton } from "./AISettingsButton";
import { ArticleHistory } from "./ArticleHistory";

export function CreatePage({
  drafts,
  openDraft,
  removeDraft,
  openHistory,
  input,
  setInput,
  loading,
  aiConfigured,
  aiPreferences,
  platformStatus,
  openService,
  cancelGeneration,
  generate,
  addFiles,
  fileRef,
  uploads,
  dismissUpload,
  assets,
  removeImage,
  reuploadAsset,
  moveImage,
  setToast,
}) {
  const [dragging, setDragging] = useState(false);
  const [previewFile, setPreviewFile] = useState(null);
  const [previewImage, setPreviewImage] = useState(null);
  const isUploading = uploads.some(item => item.status !== 'error');
  const [historyOpen, setHistoryOpen] = useState(false);
  const textCount =
    input.text.length +
    input.files.reduce((n, f) => n + (f.text?.length || 0), 0);
  const hasText = Boolean(
    input.text.trim() || input.files.some((f) => f.ok && f.text),
  );
  const valid =
    input.mode === "raw"
      ? Boolean(
          input.text.trim() ||
          input.files.filter((f) => f.ok && f.text).length === 1,
        )
      : input.mode === "polish"
        ? hasText
        : Boolean(input.topic.trim().length >= 5 || hasText);
  const inputError =
    textCount > 30000
      ? "素材总量超出 30,000 字"
      : input.mode === "raw" && !valid
        ? "请粘贴原文或添加一个可读取的文档"
        : input.mode === "polish" && !valid
          ? "请添加需要润色的正文或文档"
          : input.mode === "create" && !valid
            ? input.topic.trim()
              ? "主题至少需要 5 个字符"
              : "请输入主题或添加素材"
            : "";
  return (
    <main className="create-shell">
      <header className="brandbar">
        <div className="wordmark"><span className="mark">W</span><strong>Weave</strong><span className="brand-divider"/><small>内容工作台</small></div>
        <div className="brand-actions">
          <button className="ghost-action article-history-action" onClick={() => setHistoryOpen(true)} title="历史记录" aria-label="历史记录"><History size={16}/><span>历史记录</span></button>
          <AISettingsButton configured={aiConfigured} onClick={openService} />
        </div>
      </header>
      <section className="hero">
        <div><p className="eyebrow">WORKSPACE</p><h1>新建文章<span>.</span></h1></div>
        <div className="hero-index" aria-label="创作流程"><span className="hero-step active">01 素材</span><ArrowRight size={13}/><span className="hero-step">02 编辑</span><ArrowRight size={13}/><span className="hero-step">03 导出</span></div>
      </section>
      <section className="create-grid">
        <div className="input-column">
          <div className="section-caption"><span>文章素材</span><span>自动保存</span></div>
          <div className="field-block">
            <label htmlFor="article-topic">主题<small>{input.mode === 'create' ? '或直接添加素材' : '选填'}</small></label>
            <input id="article-topic" maxLength={64} value={input.topic} disabled={loading} onChange={event => setInput({ ...input, topic: event.target.value })} placeholder="想写点什么？"/>
            {input.topic.trim() && <div className="field-meta"><span>{input.topic.trim().length}/64</span></div>}
          </div>
          <div className="field-block material-field">
            <label htmlFor="article-material">{input.mode === 'raw' || input.mode === 'polish' ? '原文' : '素材'}</label>
            <div className="material-editor"><textarea id="article-material" value={input.text} disabled={loading} onChange={event => setInput({ ...input, text: event.target.value })} placeholder="粘贴文字、笔记，或在下方添加文件…"/><div className="material-footer"><span className={textCount > 30000 ? 'error' : ''}>{textCount.toLocaleString()} / 30,000 字</span>{input.text && <button className="text-link" disabled={loading} onClick={() => setInput({ ...input, text: '' })}>清空</button>}</div></div>
            {inputError && (input.text || input.topic || input.files.length > 0) && <div className="field-validation">{inputError}</div>}
          </div>
          <div className={`upload-row${dragging ? ' is-dragging' : ''}`} onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false); }} onDrop={event => { event.preventDefault(); setDragging(false); if (!loading) addFiles(event.dataTransfer.files); }}>
            <button className="upload-zone" disabled={isUploading || loading} onClick={() => { fileRef.current.accept = '.docx,.pdf,.txt,.md'; fileRef.current.click(); }}><span className="upload-icon"><Upload size={18}/></span><span>添加文档<small>DOCX / PDF / TXT / MD · 20 MB</small></span><Plus size={15}/></button>
            <button className="upload-zone" disabled={isUploading || loading} onClick={() => { fileRef.current.accept = 'image/jpeg,image/png,image/webp'; fileRef.current.click(); }}><span className="upload-icon"><ImagePlus size={18}/></span><span>添加图片<small>JPG / PNG / WEBP · 10 MB</small></span><Plus size={15}/></button>
            <input ref={fileRef} hidden type="file" multiple onChange={event => { addFiles(event.target.files); event.target.value = ''; }}/>
          </div>
          {uploads.length > 0 && <div className="upload-queue" aria-live="polite">{uploads.map(item => <div className={`upload-task${item.status === 'error' ? ' is-error' : ''}`} key={item.id}>
            {item.status === 'error' ? <FileText size={17}/> : <RefreshCw className="spin" size={17}/>}<div><strong>{item.file.name}</strong><small>{item.status === 'error' ? item.error : item.status === 'pending' ? '等待上传' : /\.(docx|pdf|txt|md)$/i.test(item.file.name) ? '正在解析…' : '正在上传…'}</small></div>
            {item.status === 'error' && <><button className="text-link" disabled={isUploading || loading} onClick={() => { dismissUpload(item.id); addFiles([item.file]); }}>重试</button><button className="asset-remove" aria-label="移除上传记录" onClick={() => dismissUpload(item.id)}><X size={14}/></button></>}
          </div>)}</div>}
          {(input.files.length > 0 || input.images.length > 0) && <section className="material-assets">
            <div className="section-caption"><span>已添加 <b>{input.files.length + input.images.length}</b></span><small>{input.files.length > 0 ? `${input.files.length} 个文档` : ''}{input.files.length > 0 && input.images.length > 0 ? ' · ' : ''}{input.images.length > 0 ? `${input.images.length} 张图片` : ''}</small></div>
            {input.files.length > 0 && <div className="asset-list">{input.files.map((file, index) => <div className={`document-asset${file.ok ? '' : ' is-error'}`} key={`${file.name}:${index}`}>
              <div className="asset-line"><span className="file-icon"><FileText size={18}/></span><div className="asset-file-info"><strong title={file.name}>{file.name}</strong><small>{file.ok ? `${(file.text?.length || 0).toLocaleString()} 字 · 已解析` : file.error || '解析失败'}</small></div>{file.ok && file.preview && <button className="asset-control" aria-label={previewFile === index ? '收起文档' : '预览文档'} aria-expanded={previewFile === index} onClick={() => setPreviewFile(previewFile === index ? null : index)}>{previewFile === index ? <ChevronUp size={15}/> : <ChevronDown size={15}/>}</button>}<button className="asset-remove" aria-label={`移除文档：${file.name}`} disabled={loading} onClick={() => { setInput(value => ({ ...value, files: value.files.filter((_, i) => i !== index) })); setPreviewFile(null); }}><X size={15}/></button></div>
              {previewFile === index && <p className="asset-preview-text">{file.preview}</p>}{file.warnings?.length > 0 && <p className="asset-warning">{file.warnings.join('；')}</p>}
            </div>)}</div>}
            {input.images.length > 0 && <div className="image-asset-grid">{input.images.map((file, index) => { const asset = assets.get(file.id); return <div className="image-asset-card" key={file.id || index}>
              <button className="image-asset-preview" onClick={() => setPreviewImage(file.id)} aria-label={`预览图片：${file.name}`}><img src={asset?.previewUrl || asset?.cacheUrl || asset?.url} alt={file.name}/><span className="image-order">{String(index + 1).padStart(2, '0')}</span>{asset?.pasteStatus === 'broken' && <span className="image-broken">需重新上传</span>}</button>
              <div className="image-asset-caption"><strong title={file.name}>{file.name}</strong><small>{asset?.width && asset?.height ? `${asset.width} × ${asset.height}` : '图片素材'}</small></div><div className="asset-controls"><button aria-label="前移图片" disabled={index === 0 || loading} onClick={() => moveImage(index, -1)}><ArrowLeft size={14}/></button><button aria-label="后移图片" disabled={index === input.images.length - 1 || loading} onClick={() => moveImage(index, 1)}><ArrowRight size={14}/></button>{asset?.pasteStatus === 'broken' && <button className="text-link" disabled={loading} onClick={() => reuploadAsset(file.id)}>重传</button>}<button className="asset-remove" aria-label={`移除图片：${file.name}`} disabled={loading} onClick={() => removeImage(file.id)}><X size={14}/></button></div>
            </div>; })}</div>}
          </section>}
        </div>
        <aside className="settings-column">
          <div className="section-caption"><span>创作设置</span><Settings2 size={14}/></div>
          <div className="setting-section"><label>方式</label><div className="mode-list">{Object.entries(CREATION_MODES).map(([id, { label, hint }]) => <button className={input.mode === id ? 'mode-option active' : 'mode-option'} key={id} disabled={loading} aria-pressed={input.mode === id} onClick={() => setInput({ ...input, mode: id })}><span><strong>{label}</strong><small>{hint}</small></span><span className="radio-dot">{input.mode === id && <Check size={11}/>}</span></button>)}</div></div>
          {input.mode !== 'raw' && <><div className="setting-section"><label>语气</label><div className="segmented">{Object.entries(WRITING_TONES).map(([id, { label, hint }]) => <button className={input.tone === id ? 'selected' : ''} key={id} title={hint} aria-pressed={input.tone === id} disabled={loading} onClick={() => setInput({ ...input, tone: id })}>{label}</button>)}</div></div><div className="setting-section"><label>字数<small>约 ±15%</small></label><div className="segmented">{TARGET_LENGTHS.map(length => <button className={input.targetLength === length ? 'selected' : ''} key={length} aria-pressed={input.targetLength === length} disabled={loading} onClick={() => setInput({ ...input, targetLength: length })}>{length}</button>)}</div></div></>}
          {input.mode !== 'raw' && aiConfigured === false && <div className="ai-config-error" role="status"><span>{aiPreferences.provider === 'personal' ? '请先完成个人 AI 配置' : platformStatus?.configurationError?.message || '平台 AI 尚未配置'}</span><button onClick={openService}>设置</button></div>}
          <div className="create-submit"><button className="primary-action" disabled={!valid || textCount > 30000 || loading || isUploading || (input.mode !== 'raw' && !aiConfigured)} onClick={generate}>{loading ? <><RefreshCw size={16} className="spin"/>生成中…</> : <>{input.mode === 'raw' ? <FileText size={16}/> : <Sparkles size={16}/>} {input.mode === 'raw' ? '开始排版' : input.mode === 'polish' ? '润色文章' : '生成文章'}<ArrowRight size={16}/></>}</button>{loading ? <div className="generation-feedback" role="status"><span className="activity-line"/><span>正在撰写与检查内容</span><button className="text-link" onClick={cancelGeneration}>取消</button></div> : <p className="submit-note">{isUploading ? '等待素材上传完成' : input.mode === 'raw' ? '保留原文，直接进入编辑' : aiConfigured ? '生成后可继续编辑与排版' : '选择可用的 AI 服务后开始创作'}</p>}</div>
        </aside>
      </section>
      {historyOpen && <ArticleHistory
        drafts={drafts}
        onClose={() => setHistoryOpen(false)}
        onOpenDraft={async id => {
          const hasMaterials = input.topic.trim() || input.text.trim() || input.files.length || input.images.length;
          if (hasMaterials && !window.confirm('继续编辑草稿将清空当前尚未生成的新文章素材，是否继续？')) return false;
          const opened = await openDraft(id);
          if (opened) setHistoryOpen(false);
          return opened;
        }}
        onDeleteDraft={removeDraft}
        onOpen={async record => { await openHistory(record); setHistoryOpen(false); }}
        setToast={setToast}
      />}
      {previewImage && assets.get(previewImage) && <div className="modal-backdrop" onClick={() => setPreviewImage(null)}><div className="asset-lightbox" role="dialog" aria-modal="true" aria-label="图片预览" onClick={event => event.stopPropagation()}><button className="modal-close" aria-label="关闭图片预览" onClick={() => setPreviewImage(null)}><X size={20}/></button><img src={assets.get(previewImage).previewUrl || assets.get(previewImage).cacheUrl || assets.get(previewImage).url} alt="素材预览"/></div></div>}
    </main>
  );
}
