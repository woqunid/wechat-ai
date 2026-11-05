import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, FileText, Image, Paperclip, Sparkles, RefreshCw, Square, X } from 'lucide-react';
import { uid } from './core.js';
import { AIEditResponseSchema, AI_EDIT_TIMEOUT_MS, buildAIEdit, createAIReference, describeAIEdit, mergeAIEdit, sameAIReference, validAIReference } from './ai-edit.js';
import { loadAIEditAttachments, saveAIEditAttachments } from './storage.js';
import { renderArticle } from './renderer.js';
import { getTemplate } from './templates.js';
import { inspectLayoutPreview } from './layout-preview.js';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_IMAGES = 10;
const MAX_ATTACHMENT_IMAGE_BYTES = 20 * 1024 * 1024;
const attachmentImages = attachment => attachment.kind === 'image' ? [attachment] : attachment.images || [];
const withAttachmentPreviews = attachment => attachment.kind === 'image'
  ? { ...attachment, previewUrl: attachment.blob ? URL.createObjectURL(attachment.blob) : attachment.cacheUrl }
  : { ...attachment, images: (attachment.images || []).map(image => ({ ...image, previewUrl: image.blob ? URL.createObjectURL(image.blob) : image.cacheUrl })) };
export function useAIEdit({ article, setArticle, assets, disabled, onApplied, onCandidate, setToast }) {
  const [references, setReferences] = useState([]);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [attachmentsReady, setAttachmentsReady] = useState(false);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [candidate, setCandidate] = useState(null);
  const [showCandidate, setShowCandidate] = useState(true);
  const request = useRef(null);
  const latest = useRef(null);
  const previewUrls = useRef(new Set());
  const loadedAttachmentsFor = useRef(null);
  latest.current = { article, references, disabled, assets, attachments };
  const registerPreviewUrls = values => values.forEach(attachment => attachmentImages(attachment).forEach(image => {
    if (image.previewUrl?.startsWith('blob:')) previewUrls.current.add(image.previewUrl);
  }));
  const releasePreviewUrls = values => values.forEach(attachment => attachmentImages(attachment).forEach(image => {
    if (image.previewUrl?.startsWith('blob:')) {
      URL.revokeObjectURL(image.previewUrl);
      previewUrls.current.delete(image.previewUrl);
    }
  }));
  const replaceAttachments = values => {
    latest.current.attachments = values;
    setAttachments(values);
  };
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setReferences([]); setMessages([]); setPrompt(''); setBusy(''); setError(''); setCandidate(null); setShowCandidate(true);
    setAttachments([]); latest.current.attachments = []; setAttachmentsReady(false);
    loadedAttachmentsFor.current = null;
    let active = true;
    loadAIEditAttachments(article.id).then(saved => {
      const restored = saved.map(withAttachmentPreviews);
      if (!active) { releasePreviewUrls(restored); return; }
      registerPreviewUrls(restored);
      loadedAttachmentsFor.current = article.id;
      latest.current.attachments = restored;
      setAttachments(restored);
      setAttachmentsReady(true);
    }).catch(() => { if (active) { setAttachmentsReady(true); setError('附件缓存读取失败'); } });
    return () => {
      active = false;
      request.current?.abort(); request.current = null;
      for (const url of previewUrls.current) URL.revokeObjectURL(url);
      previewUrls.current.clear();
    };
  }, [article.id]);
  useEffect(() => {
    if (!attachmentsReady || loadedAttachmentsFor.current !== article.id) return undefined;
    const timer = setTimeout(() => saveAIEditAttachments(article.id, attachments).catch(() => setError('附件缓存保存失败')), 300);
    return () => clearTimeout(timer);
  }, [article.id, attachments, attachmentsReady]);

  const resolved = useMemo(() => {
    if (!candidate) return {};
    try {
      if (candidate.references.some(reference => !validAIReference(article, reference))) throw new Error('生成时引用的内容已变化，此方案已失效，请取消方案后重新生成');
      return { article: mergeAIEdit(candidate.base, candidate.next, article) };
    } catch (cause) { return { problem: cause.message }; }
  }, [candidate, article]);
  const changes = useMemo(() => candidate ? describeAIEdit(resolved.article ? article : candidate.base, resolved.article || candidate.next) : [], [article, candidate, resolved]);
  const invalidReferences = references.filter(reference => !validAIReference(article, reference));
  const addReference = value => {
    let reference;
    try { reference = createAIReference(latest.current.article, value); }
    catch { setError('所选内容过长，请缩小选区；AI仍会读取全文'); return; }
    if (!reference || references.some(item => sameAIReference(item, reference))) return;
    if (references.length >= 100) { setError('最多保留100处关注引用，请点击×移除部分引用'); return; }
    setReferences(previous => {
      if (previous.some(item => sameAIReference(item, reference))) return previous;
      return previous.length < 100 ? [...previous, reference] : previous;
    });
  };
  const restoreReferences = values => {
    const valid = values.filter(reference => validAIReference(latest.current.article, reference));
    if (valid.length < values.length) setError('部分引用内容已变化，请重新选中后发送');
    setReferences(previous => [...previous, ...valid.filter(reference => !previous.some(item => sameAIReference(item, reference)))].slice(0, 100));
  };
  const stop = () => {
    request.current?.abort(); request.current = null; setBusy('');
    setError('已停止，原稿和已有方案均已保留，可继续输入要求');
  };
  const discard = () => {
    setMessages(previous => previous.map(message => message.id === candidate?.messageId ? { ...message, status: 'discarded' } : message));
    setCandidate(null); setShowCandidate(true); setError('');
  };
  const checkReferences = (source, values) => {
    if (values.some(reference => !validAIReference(source, reference))) throw new Error('引用内容已失效，请点击卡片上的×移除后重新选择');
  };
  const inspect = async (next, signal) => {
    const html = renderArticle(next, getTemplate(next.templateId), latest.current.assets, { mode: 'preview' }).html;
    await inspectLayoutPreview(html, signal);
  };
  const addAttachments = async files => {
    if (!attachmentsReady || attachmentBusy || disabled || busy) return;
    const selectedFiles = [...files];
    const slots = MAX_ATTACHMENTS - latest.current.attachments.length;
    if (selectedFiles.length > slots) setToast(`最多保留${MAX_ATTACHMENTS}个附件`);
    const pendingFiles = selectedFiles.slice(0, Math.max(0, slots));
    if (!pendingFiles.length) return;
    setAttachmentBusy(true); setError('');
    const added = [];
    try {
      for (const file of pendingFiles) {
        const form = new FormData();
        form.append('file', file, file.name);
        const response = await fetch('/api/articles/edit/attachments', { method: 'POST', body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error?.message || '附件上传失败');
        let attachment = { ...data.attachment, id: uid('att') };
        if (attachment.kind === 'image') {
          attachment = { ...attachment, blob: file, previewUrl: URL.createObjectURL(file) };
        } else {
          attachment.images = await Promise.all((attachment.images || []).map(async image => {
            const cached = await fetch(image.cacheUrl);
            if (!cached.ok) throw new Error('文档图片缓存读取失败，请重新上传文档');
            const blob = await cached.blob();
            return { ...image, blob, previewUrl: URL.createObjectURL(blob) };
          }));
        }
        const imageCount = [...latest.current.attachments, ...added].reduce((total, item) => total + attachmentImages(item).length, 0) + attachmentImages(attachment).length;
        const imageBytes = [...latest.current.attachments, ...added, attachment].reduce((total, item) => total + attachmentImages(item).reduce((bytes, image) => bytes + (image.bytes || 0), 0), 0);
        if (imageCount > MAX_ATTACHMENT_IMAGES || imageBytes > MAX_ATTACHMENT_IMAGE_BYTES) {
          releasePreviewUrls([attachment]);
          throw new Error(imageCount > MAX_ATTACHMENT_IMAGES ? `附件图片最多${MAX_ATTACHMENT_IMAGES}张` : '附件图片总大小不能超过20 MB');
        }
        added.push(attachment);
        registerPreviewUrls([attachment]);
        if (attachment.warning) setToast(attachment.warning);
      }
      if (latest.current.article.id !== article.id) throw new Error('文章已切换，请重新添加附件');
      const next = [...latest.current.attachments, ...added];
      await saveAIEditAttachments(article.id, next);
      replaceAttachments(next);
    } catch (cause) {
      if (added.length) releasePreviewUrls(added);
      setError(cause.message || '附件上传失败');
    } finally { setAttachmentBusy(false); }
  };
  const removeAttachment = attachmentId => {
    const current = latest.current.attachments;
    const removed = current.find(attachment => attachment.id === attachmentId);
    const next = current.filter(attachment => attachment.id !== attachmentId);
    if (removed) releasePreviewUrls([removed]);
    replaceAttachments(next);
    saveAIEditAttachments(article.id, next).catch(() => setError('附件缓存保存失败'));
  };
  const ensureImageCache = async (image, signal) => {
    try {
      const existing = await fetch(image.cacheUrl, { method: 'HEAD', signal });
      if (existing.ok) return image;
    } catch (cause) { if (signal.aborted) throw cause; }
    if (!image.blob) throw new Error('附件图片缓存已过期，请移除后重新上传');
    const form = new FormData();
    form.append('file', image.blob, image.name || 'attachment.png');
    const response = await fetch('/api/assets', { method: 'POST', body: form, signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || '附件图片缓存恢复失败');
    return { ...image, assetId: data.asset.id, cacheUrl: data.asset.cacheUrl, mime: data.asset.mime, bytes: data.asset.bytes };
  };
  const ensureAttachmentCaches = async (values, signal) => Promise.all(values.map(async attachment => {
    if (attachment.kind === 'image') return { ...await ensureImageCache(attachment, signal) };
    return { ...attachment, images: await Promise.all((attachment.images || []).map(image => ensureImageCache(image, signal))) };
  }));
  const submit = async event => {
    event?.preventDefault();
    if (request.current || disabled || attachmentBusy || !attachmentsReady || !prompt.trim()) return;
    const original = latest.current.article;
    const selected = [...latest.current.references];
    let working;
    try {
      checkReferences(original, selected);
      if (resolved.problem) throw new Error(resolved.problem);
      working = candidate ? mergeAIEdit(candidate.base, candidate.next, original) : original;
    } catch (cause) { setError(cause.message); return; }
    const instruction = prompt.trim();
    const controller = new AbortController();
    request.current = controller;
    setBusy('generating'); setError(''); setPrompt('');
    const userMessageId = uid('msg');
    setMessages(previous => [...previous.map(message => message.retryReferences ? { ...message, retryReferences: undefined } : message), { id: userMessageId, role: 'user', text: instruction, referenceCount: selected.length, references: selected.map(({ kind, text }) => ({ kind, text })), retryReferences: selected, attachmentNames: latest.current.attachments.map(attachment => attachment.name) }]);
    try {
      const cachedAttachments = await ensureAttachmentCaches([...latest.current.attachments], controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      replaceAttachments(cachedAttachments);
      await saveAIEditAttachments(original.id, cachedAttachments);
      const requestAttachments = cachedAttachments.map(attachment => attachment.kind === 'image'
        ? { kind: 'image', name: attachment.name, assetId: attachment.assetId }
        : { kind: 'document', name: attachment.name, text: attachment.text, imageAssetIds: attachment.images.map(image => image.assetId) });
      const responsePromise = fetch('/api/articles/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: working, prompt: instruction, references: selected.map(({ snapshot, assetId, ...reference }) => reference), messages: messages.slice(-16).map(message => ({ role: message.role, text: message.text.slice(0, 4000) })), attachments: requestAttachments }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(AI_EDIT_TIMEOUT_MS + 10000)]),
      });
      const sentReferenceIds = new Set(selected.map(reference => reference.id));
      setReferences(previous => previous.filter(reference => !sentReferenceIds.has(reference.id)));
      const response = await responsePromise;
      const data = await response.json();
      if (!response.ok) {
        const issue = new Error(data.error?.code === 'NOT_FOUND' ? 'AI修改接口尚未启动，请重启后端服务' : data.error?.message || '修改方案生成失败');
        issue.code = data.error?.code;
        throw issue;
      }
      const result = AIEditResponseSchema.parse({ message: data.message, operations: data.operations });
      const next = buildAIEdit(working, result.operations);
      const changed = describeAIEdit(working, next).length > 0;
      const hasChanges = describeAIEdit(original, next).length > 0;
      if (changed && hasChanges) {
        checkReferences(latest.current.article, selected);
        const merged = mergeAIEdit(original, next, latest.current.article);
        await inspect(merged, controller.signal);
        checkReferences(latest.current.article, selected);
        mergeAIEdit(original, next, latest.current.article);
      }
      if (controller.signal.aborted || request.current !== controller) return;
      const messageId = uid('msg');
      setMessages(previous => [...previous.map(message => ({ ...(message.retryReferences ? { ...message, retryReferences: undefined } : message), ...(changed && message.id === candidate?.messageId ? { status: 'superseded' } : {}) })), { id: messageId, role: 'assistant', text: result.message, ...(changed && hasChanges ? { status: 'pending' } : {}) }]);
      if (changed) { setCandidate(hasChanges ? { base: original, next, references: selected, messageId } : null); setShowCandidate(true); if (hasChanges) onCandidate?.(); }
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) {
        if (cause.code === 'VISION_UNSUPPORTED') {
          setToast('当前模型不支持多模态识图');
          setError('');
        } else setError(cause.name === 'TimeoutError' ? '修改方案生成超时，原稿已保留，可重新发送' : cause.message || '网络中断，原稿已保留');
      }
    } finally {
      if (request.current === controller) { request.current = null; setBusy(''); }
    }
  };
  const apply = async () => {
    if (!candidate || request.current || disabled || resolved.problem) return;
    const controller = new AbortController();
    request.current = controller; setBusy('checking'); setError('');
    try {
      const source = latest.current.article;
      checkReferences(source, candidate.references);
      const next = mergeAIEdit(candidate.base, candidate.next, source);
      await inspect(next, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (latest.current.article !== source) throw new Error('检查期间正文发生变化，请重新点击应用，原稿已保留');
      if (latest.current.disabled) throw new Error('请先结束其他生成或排版试用，再应用本次修改');
      checkReferences(source, candidate.references);
      setArticle({ ...next, settings: { ...next.settings, aiEdited: true }, updatedAt: new Date().toISOString() });
      setMessages(previous => previous.map(message => message.id === candidate.messageId ? { ...message, status: 'applied' } : message));
      setCandidate(null); setShowCandidate(true); onApplied();
      setToast('修改已应用，可撤销');
    } catch (cause) { if (!controller.signal.aborted) setError(cause.message || '方案检查失败，原稿已保留'); }
    finally { if (request.current === controller) { request.current = null; setBusy(''); } }
  };
  return { references, messages, prompt, setPrompt, busy, error, attachments, attachmentsReady, attachmentBusy, addAttachments, removeAttachment, candidate, problem: resolved.problem, changes, invalidReferences, showCandidate, setShowCandidate, previewArticle: showCandidate && !disabled ? resolved.article : null, addReference, restoreReferences, removeReference: referenceId => setReferences(previous => previous.filter(reference => reference.id !== referenceId)), submit, stop, discard, apply };
}

export function AIEditPanel({ editor, article, assets, disabled, onLocate }) {
  const end = useRef(null);
  const fileInput = useRef(null);
  const lastUserMessage = editor.messages.findLast(message => message.role === 'user');
  const lastInstruction = lastUserMessage?.text;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [editor.messages, editor.busy]);
  return <section className="ai-edit-panel" aria-label="AI修改对话">
    <div className="ai-edit-context"><span><span className="connection-dot connected"/>全文上下文</span><small title="引用用于提示关注点">选中内容可添加引用</small></div>
    <div className="ai-edit-messages" role="log" aria-label="修改对话记录" aria-live="polite" aria-relevant="additions text">
      {!editor.messages.length && <div className="ai-edit-empty"><span className="ai-empty-icon"><Sparkles size={23}/></span><h3>让文章更进一步</h3><p>调整文字、图片或排版。</p><div className="ai-prompt-suggestions">{['精简表达，保留关键信息', '优化开头，更快切入主题', '统一段落间距与文字样式'].map(text => <button type="button" key={text} disabled={disabled} onClick={() => editor.setPrompt(text)}>{text}<ArrowUp size={13}/></button>)}</div></div>}
      {editor.messages.map(message => <div key={message.id} className={`ai-edit-message ${message.role}`}><strong>{message.role === 'user' ? '你' : <><Sparkles size={12}/>Weave AI</>}</strong><p>{message.text}</p>{message.referenceCount > 0 && <details className="ai-edit-message-references"><summary>{message.referenceCount} 处引用</summary><div>{message.references?.map((reference, index) => <p key={index}>{reference.text || '图片引用'}</p>)}</div></details>}{message.attachmentNames?.length > 0 && <small>附件：{message.attachmentNames.join('、')}</small>}{message.status && <small className={`ai-message-status ${message.status}`}>{({ pending: editor.problem ? '方案已失效' : '待应用', applied: '已应用', discarded: '已取消', superseded: '已有新方案' })[message.status]}</small>}</div>)}
      {editor.busy && <div className="ai-edit-progress" role="status"><span className="ai-thinking"><i/><i/><i/></span><span>{editor.busy === 'checking' ? '检查改动与布局…' : '生成修改方案…'}</span></div>}
      <div ref={end}/>
    </div>
    {editor.candidate && <div className={`ai-edit-review${editor.problem ? ' is-invalid' : ''}`}>
      <div className="ai-edit-review-title"><span className="review-icon"><Check size={15}/></span><strong>{editor.problem ? '方案已失效' : `${editor.changes.length} 项改动`}</strong><span>未应用</span><button type="button" className="asset-remove" aria-label="取消方案" disabled={Boolean(editor.busy)} onClick={editor.discard}><X size={15}/></button></div>
      {editor.problem ? <p role="alert">{editor.problem}</p> : <div className="ai-edit-change-list">{editor.changes.map((change, index) => <details key={`${change.key}:${index}`}><summary><span>{String(index + 1).padStart(2, '0')}</span>{change.label}</summary><div><label>修改前</label><p className="change-before">{change.before || '空'}</p><label>修改后</label><p className="change-after">{change.after || '空'}</p>{change.key !== 'layout' && <button type="button" className="text-link" onClick={() => onLocate?.(change.key)}>定位</button>}</div></details>)}</div>}
      <div className="ai-edit-review-actions"><button type="button" className="ghost-action" disabled={Boolean(editor.problem)} aria-pressed={!editor.showCandidate} onClick={() => editor.setShowCandidate(value => !value)}>{editor.showCandidate ? '查看原稿' : '预览方案'}</button><button type="button" className="publish-action" aria-label="应用本次修改" disabled={Boolean(editor.busy || editor.problem || disabled)} onClick={editor.apply}>{editor.busy === 'checking' ? <RefreshCw size={14} className="spin"/> : <Check size={14}/>}应用修改</button></div>
    </div>}
    {disabled && <p className="ai-edit-error" role="status">请先结束当前生成或排版预览。</p>}
    {editor.error && <div className="ai-edit-error" role="alert"><p>{editor.error}</p>{lastInstruction && !editor.prompt && <button className="text-link" type="button" onClick={() => { editor.setPrompt(lastInstruction); editor.restoreReferences(lastUserMessage.retryReferences || []); }}>填回上次要求</button>}</div>}
    <form className="ai-edit-composer" onSubmit={editor.submit}>
      {editor.references.length > 0 && <div className="ai-edit-references" aria-label="关注内容引用">{editor.references.map(reference => {
        const valid = validAIReference(article, reference);
        const asset = assets.get(reference.assetId);
        return <div className={`ai-edit-reference${valid ? '' : ' is-invalid'}`} key={reference.id}>
          {reference.kind === 'image' && (asset ? <img src={asset.previewUrl || asset.cacheUrl || asset.url} alt="引用图片缩略图"/> : <Image size={22}/>)}
          <div><span>{valid ? reference.kind === 'image' ? '图片' : '文字' : '已失效'}</span><p title={reference.text}>{reference.text}</p></div><button type="button" className="ai-edit-reference-remove" aria-label={`移除引用：${reference.text.slice(0, 20)}`} onClick={() => editor.removeReference(reference.id)}><X size={12}/></button>
        </div>;
      })}</div>}
      {editor.attachments?.length > 0 && <div className="ai-edit-attachments" aria-label="已添加附件">{editor.attachments.map(attachment => <div className={`ai-edit-attachment${attachment.kind === 'image' ? ' is-image' : ''}`} key={attachment.id}>
        {attachment.kind === 'image' ? <img className="ai-edit-attachment-thumb" src={attachment.previewUrl} alt="附件图片预览"/> : <span className="ai-edit-attachment-icon"><FileText size={17}/></span>}
        <div className="ai-edit-attachment-meta"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.kind === 'image' ? '图片' : `${attachment.charCount.toLocaleString()} 字${attachment.images?.length ? ` · ${attachment.images.length} 张图片` : ''}`}</small></div>
        {attachment.kind === 'document' && attachment.images?.length > 0 && <div className="ai-edit-attachment-images" aria-label="文档内嵌图片">{attachment.images.slice(0, 3).map(image => <img key={image.assetId} src={image.previewUrl} alt="文档内嵌图片预览"/>)}{attachment.images.length > 3 && <small>+{attachment.images.length - 3}</small>}</div>}
        <button type="button" className="ai-edit-reference-remove" aria-label={`移除附件：${attachment.name}`} title="移除附件" onClick={() => editor.removeAttachment(attachment.id)}><X size={12}/></button>
      </div>)}</div>}
      <input ref={fileInput} className="ai-edit-file-input" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,.docx,.txt,.md" onChange={event => { editor.addAttachments(event.target.files); event.target.value = ''; }}/>
      <textarea aria-label="AI修改要求" value={editor.prompt} disabled={disabled} onChange={event => editor.setPrompt(event.target.value)} maxLength={4000} rows={3} placeholder={editor.candidate ? '继续调整方案…' : '你想如何调整？'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); editor.submit(); } }}/>
      <div className="ai-edit-composer-footer"><button className="ai-edit-upload" type="button" aria-label="上传图片或文档" title="上传图片或文档" disabled={disabled || editor.busy || editor.attachmentBusy || editor.attachmentsReady === false} onClick={() => fileInput.current?.click()}><Paperclip size={16}/></button><span>Enter 发送 · Shift + Enter 换行</span>{editor.busy ? <button className="ai-edit-send stop" type="button" onClick={editor.stop} aria-label="停止生成"><Square size={13}/></button> : <button className="ai-edit-send" type="submit" aria-label="发送修改要求" disabled={disabled || editor.attachmentBusy || editor.attachmentsReady === false || !editor.prompt.trim() || editor.invalidReferences.length > 0 || Boolean(editor.problem)}><ArrowUp size={18}/></button>}</div>
      {editor.attachmentBusy && <p className="ai-edit-upload-progress" role="status"><RefreshCw size={12} className="spin"/>正在处理附件…</p>}
      {editor.invalidReferences.length > 0 && <p className="ai-edit-reference-warning" role="status">请移除失效引用后重选。</p>}
    </form>
  </section>;
}
