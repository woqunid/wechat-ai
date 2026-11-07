import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, FileText, Image, Link2, Paperclip, Sparkles, RefreshCw, Square, X } from 'lucide-react';
import { uid } from './core.js';
import { absoluteUrl, assetAvailable, postJson, requestJson, uploadAsset } from './api.js';
import { AIEditResponseSchema, AI_EDIT_TIMEOUT_MS, aiEditConversation, aiEditSummary, aiEditTargets, appliedAIEditStatus, buildAIEdit, createAIReference, describeAIEdit, isImageBlock, mergeAIEdit, revertAIEdit, sameAIReference, validAIReference } from './ai-edit.js';
import { readImageLink } from './image-assets.js';
import { loadAIEditAttachments, saveAIEditAttachments } from './storage.js';
import { renderArticle } from './renderer.js';
import { getTemplate } from './templates.js';
import { inspectLayoutPreview } from './layout-preview.js';

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_IMAGES = 10;
const MAX_ATTACHMENT_IMAGE_BYTES = 20 * 1024 * 1024;
const attachmentImages = attachment => attachment.kind === 'image' ? [attachment] : attachment.images || [];
const imageLimitError = values => {
  const images = values.flatMap(attachmentImages);
  if (images.length > MAX_ATTACHMENT_IMAGES) return `附件图片最多${MAX_ATTACHMENT_IMAGES}张`;
  if (images.reduce((bytes, image) => bytes + (image.bytes || 0), 0) > MAX_ATTACHMENT_IMAGE_BYTES) return '附件图片总大小不能超过20 MB';
  return '';
};
const linkName = url => {
  try {
    const { hostname, pathname } = new URL(url);
    return (decodeURIComponent(pathname.split('/').filter(Boolean).at(-1) || '') || hostname).replace(/\p{Cc}/gu, '').slice(0, 240) || '链接图片';
  } catch { return '链接图片'; }
};
const withAttachmentPreviews = attachment => attachment.kind === 'image'
  ? { ...attachment, previewUrl: attachment.blob ? URL.createObjectURL(attachment.blob) : attachment.cacheUrl }
  : { ...attachment, images: (attachment.images || []).map(image => ({ ...image, previewUrl: image.blob ? URL.createObjectURL(image.blob) : image.cacheUrl })) };
export function useAIEdit({ article, setArticle, assets, aiRequest, disabled, onApplied, onCandidate, onRegisterAsset, setToast }) {
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
  const [autoApply, setAutoApply] = useState(false);
  const request = useRef(null);
  const requestMessage = useRef(null);
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
      return { article: mergeAIEdit(candidate.base, candidate.next, article) };
    } catch (cause) { return { problem: cause.message }; }
  }, [candidate, article]);
  const changes = useMemo(() => candidate ? describeAIEdit(resolved.article ? article : candidate.base, resolved.article || candidate.next) : [], [article, candidate, resolved]);
  const referenceArticle = resolved.article || article;
  latest.current.referenceArticle = showCandidate && !disabled ? referenceArticle : article;
  const invalidReferences = references.filter(reference => !validAIReference(referenceArticle, reference));
  useEffect(() => {
    setMessages(previous => {
      let changed = false;
      const next = previous.map(message => {
        if (!message.appliedBase) return message;
        const status = appliedAIEditStatus(message.appliedBase, message.appliedNext, article);
        if (status === message.status) return message;
        changed = true;
        return { ...message, status };
      });
      return changed ? next : previous;
    });
  }, [article]);
  const addReference = value => {
    let reference;
    try { reference = createAIReference(latest.current.referenceArticle, value); }
    catch { setError('所选内容过长，请缩小选区；AI仍会读取全文'); return; }
    if (!reference || references.some(item => sameAIReference(item, reference))) return;
    if (references.length >= 100) { setError('最多保留100处关注引用，请点击×移除部分引用'); return; }
    setReferences(previous => {
      if (previous.some(item => sameAIReference(item, reference))) return previous;
      return previous.length < 100 ? [...previous, reference] : previous;
    });
  };
  const stop = () => {
    request.current?.abort(); request.current = null; setBusy('');
    const messageId = requestMessage.current;
    setMessages(previous => previous.map(message => message.id === messageId ? { ...message, status: 'stopped' } : message));
    requestMessage.current = null;
    setError('已停止，原稿和已有方案均已保留，可继续输入要求');
  };
  const discard = () => {
    setMessages(previous => previous.map(message => message.id === candidate?.messageId ? { ...message, status: 'discarded' } : message));
    setCandidate(null); setShowCandidate(true); setError('');
  };
  const checkReferences = (source, values) => {
    if (values.some(reference => !validAIReference(source, reference))) throw new Error('引用内容已失效，请点击卡片上的×移除后重新选择');
  };
  const inspect = async (next, signal, assets = latest.current.assets) => {
    const html = renderArticle(next, getTemplate(next.templateId), assets, { mode: 'preview', interactive: true }).html;
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
        const data = await requestJson('/api/articles/edit/attachments', { method: 'POST', body: form, fallback: '附件上传失败' });
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
        const limitError = imageLimitError([...latest.current.attachments, ...added, attachment]);
        if (limitError) {
          releasePreviewUrls([attachment]);
          throw new Error(limitError);
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
  const addImageLink = async value => {
    if (!attachmentsReady || attachmentBusy || disabled || busy) return false;
    if (latest.current.attachments.length >= MAX_ATTACHMENTS) { setError(`最多保留${MAX_ATTACHMENTS}个附件`); return false; }
    setAttachmentBusy(true); setError('');
    let asset;
    try {
      asset = await readImageLink(value);
      const attachment = { id: uid('att'), kind: 'image', name: linkName(asset.sourceUrl || value), assetId: asset.id, cacheUrl: asset.cacheUrl, url: asset.url, sourceUrl: asset.sourceUrl, mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height, expiresAt: asset.expiresAt, blob: asset.blob, previewUrl: asset.previewUrl };
      const next = [...latest.current.attachments, attachment];
      const limitError = imageLimitError(next);
      if (limitError) throw new Error(limitError);
      if (latest.current.article.id !== article.id) throw new Error('文章已切换，请重新添加图片链接');
      await saveAIEditAttachments(article.id, next);
      registerPreviewUrls([attachment]);
      replaceAttachments(next);
      return true;
    } catch (cause) {
      if (asset && !previewUrls.current.has(asset.previewUrl)) URL.revokeObjectURL(asset.previewUrl);
      setError(cause.name === 'TimeoutError' ? '图片读取超时，请重试' : cause.message || '图片读取失败');
      return false;
    } finally { setAttachmentBusy(false); }
  };
  const registerInsertedImages = async (next, values, assets) => {
    const images = values.flatMap(attachmentImages);
    let registered = assets;
    for (const block of next.blocks.filter(isImageBlock)) {
      const image = !registered.has(block.assetId) && images.find(item => item.assetId === block.assetId);
      if (!image?.blob) continue;
      const asset = { id: image.assetId, filename: image.name, mime: image.mime, bytes: image.bytes, width: image.width, height: image.height, cacheUrl: image.cacheUrl, url: absoluteUrl(image.url || image.cacheUrl), ...(image.sourceUrl ? { sourceUrl: image.sourceUrl } : {}), expiresAt: image.expiresAt, pasteStatus: 'needs-manual', blob: image.blob };
      await onRegisterAsset(asset);
      registered = new Map(registered).set(asset.id, { ...asset, previewUrl: image.previewUrl });
    }
    return registered;
  };
  const removeAttachment = attachmentId => {
    const current = latest.current.attachments;
    const removed = current.find(attachment => attachment.id === attachmentId);
    const next = current.filter(attachment => attachment.id !== attachmentId);
    if (removed) releasePreviewUrls([removed]);
    replaceAttachments(next);
    saveAIEditAttachments(article.id, next).catch(() => setError('附件缓存保存失败'));
  };
  const toggleAttachment = attachmentId => replaceAttachments(latest.current.attachments.map(attachment => attachment.id === attachmentId ? { ...attachment, enabled: attachment.enabled === false } : attachment));
  const ensureImageCache = async (image, signal) => {
    try {
      if (await assetAvailable(image.cacheUrl, signal)) return image;
    } catch (cause) { if (signal.aborted) throw cause; }
    if (!image.blob) throw new Error('附件图片缓存已过期，请移除后重新上传');
    const asset = await uploadAsset(image.blob, { filename: image.name || 'attachment.png', signal, fallback: '附件图片缓存恢复失败' });
    return { ...image, assetId: asset.id, cacheUrl: asset.cacheUrl, mime: asset.mime, bytes: asset.bytes };
  };
  const ensureAttachmentCaches = async (values, signal) => Promise.all(values.map(async attachment => {
    if (attachment.kind === 'image') return { ...await ensureImageCache(attachment, signal) };
    return { ...attachment, images: await Promise.all((attachment.images || []).map(image => ensureImageCache(image, signal))) };
  }));
  const submit = async (event, { retry, regenerate = false, withoutImages = retry?.withoutImages || false } = {}) => {
    event?.preventDefault();
    const previousRequest = regenerate ? candidate?.generationRequest : retry;
    const instruction = (previousRequest?.text || prompt).trim();
    if (request.current || disabled || attachmentBusy || !attachmentsReady || !instruction) return;
    const original = latest.current.article;
    const selected = [...(previousRequest?.retryReferences || latest.current.references)];
    let working;
    try {
      if (retry?.requestSource) working = mergeAIEdit(retry.requestBase, retry.requestSource, original);
      else if (regenerate) working = mergeAIEdit(candidate.base, candidate.generationSource, original);
      else {
        if (resolved.problem) throw new Error(resolved.problem);
        working = candidate ? mergeAIEdit(candidate.base, candidate.next, original) : original;
      }
      checkReferences(working, selected);
    } catch (cause) { setError(cause.message); return; }
    const controller = new AbortController();
    request.current = controller;
    setBusy('generating'); setError(''); if (!previousRequest) setPrompt('');
    const selectedAttachments = previousRequest ? latest.current.attachments.filter(attachment => previousRequest.attachmentIds.includes(attachment.id)) : latest.current.attachments.filter(attachment => attachment.enabled !== false);
    const userMessageId = retry?.id || uid('msg');
    requestMessage.current = userMessageId;
    const generationRequest = { id: userMessageId, role: 'user', text: instruction, status: 'pending', requestBase: original, requestSource: working, referenceCount: selected.length, references: selected.map(({ snapshot, assetId, ...reference }) => reference), retryReferences: selected, withoutImages, attachmentIds: selectedAttachments.map(attachment => attachment.id), attachmentNames: selectedAttachments.map(attachment => attachment.name) };
    setMessages(previous => [...previous.filter(message => message.id !== userMessageId), generationRequest]);
    if (regenerate) {
      setMessages(previous => previous.map(message => message.id === candidate.messageId ? { ...message, status: 'discarded' } : message));
      setCandidate(null);
    }
    try {
      const included = selectedAttachments.filter(attachment => !withoutImages || attachment.kind !== 'image').map(attachment => withoutImages && attachment.kind === 'document' ? { ...attachment, images: [] } : attachment);
      const cachedAttachments = await ensureAttachmentCaches(included, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (!withoutImages) {
        replaceAttachments(latest.current.attachments.map(attachment => cachedAttachments.find(item => item.id === attachment.id) || attachment));
        await saveAIEditAttachments(original.id, latest.current.attachments);
      }
      const requestAttachments = cachedAttachments.map(attachment => attachment.kind === 'image'
        ? { kind: 'image', name: attachment.name, assetId: attachment.assetId }
        : { kind: 'document', name: attachment.name, text: attachment.text, imageAssetIds: attachment.images.map(image => image.assetId) });
      const payload = { article: working, prompt: instruction, references: generationRequest.references, messages: aiEditConversation(messages.filter(message => message.id !== userMessageId).map(message => regenerate && message.id === candidate.messageId ? { ...message, status: 'discarded' } : message)), attachments: requestAttachments, pendingChanges: aiEditSummary(original, working), ...aiRequest };
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AI_EDIT_TIMEOUT_MS + 10000)]);
      const generate = async layoutRepair => {
        const data = await postJson('/api/articles/edit', { ...payload, ...(layoutRepair ? { layoutRepair } : {}) }, { signal, fallback: '修改方案生成失败' }).catch(issue => {
          if (issue.code === 'NOT_FOUND') issue.message = 'AI修改接口尚未启动，请重启后端服务';
          throw issue;
        });
        return AIEditResponseSchema.parse({ message: data.message, operations: data.operations });
      };
      const sentReferenceIds = new Set(selected.map(reference => reference.id));
      setReferences(previous => previous.filter(reference => !sentReferenceIds.has(reference.id)));
      const insertableAssetIds = cachedAttachments.flatMap(attachmentImages).map(image => image.assetId);
      let result, next, checkedSource, merged, errorReport, previewAssets = latest.current.assets;
      for (let attempt = 0; attempt < 2; attempt++) {
        result = await generate(attempt ? { result, issue: errorReport } : undefined);
        next = buildAIEdit(working, result.operations, { references: selected, assetIds: insertableAssetIds });
        checkedSource = latest.current.article;
        merged = mergeAIEdit(original, next, checkedSource);
        previewAssets = await registerInsertedImages(next, cachedAttachments, previewAssets);
        try {
          if (describeAIEdit(original, next).length) await inspect(merged, signal, previewAssets);
          break;
        } catch (cause) {
          if (attempt || cause.code !== 'LAYOUT_OVERFLOW') throw cause;
          errorReport = cause.message;
          setBusy('repairing');
        }
      }
      const changed = describeAIEdit(working, next).length > 0;
      const hasChanges = describeAIEdit(original, next).length > 0;
      if (controller.signal.aborted || request.current !== controller) return;
      if (latest.current.article !== checkedSource) throw new Error('检查期间正文发生变化，请重试，原稿已保留');
      if (latest.current.disabled) throw new Error('请先结束其他生成或排版试用，再重试');
      const messageId = uid('msg');
      const applyDirectly = autoApply && hasChanges;
      setMessages(previous => [...previous.map(message => ({ ...message, ...(message.id === userMessageId ? { status: 'answered' } : {}), ...((changed || applyDirectly) && message.id === candidate?.messageId ? { status: 'superseded' } : {}) })), { id: messageId, role: 'assistant', text: result.message, targets: aiEditTargets(result.operations, selected), ...(hasChanges && (changed || regenerate || applyDirectly) ? { status: applyDirectly ? 'applied' : 'pending', ...(applyDirectly ? { appliedBase: checkedSource, appliedNext: merged } : {}) } : {}) }]);
      if (applyDirectly) {
        setArticle({ ...merged, settings: { ...merged.settings, aiEdited: true }, updatedAt: new Date().toISOString() });
        setCandidate(null); setShowCandidate(true); onApplied(); setToast('修改已应用，可撤销');
      } else if (changed || regenerate) {
        setCandidate(hasChanges ? { base: original, next, messageId, generationRequest, generationSource: working } : null);
        setShowCandidate(true); if (hasChanges) onCandidate?.();
      }
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) {
        const failure = cause.code === 'VISION_UNSUPPORTED' ? '当前模型不支持识图，可去掉图片后重试' : cause.name === 'TimeoutError' ? '修改方案生成超时，原稿已保留，可重试' : cause.message || '网络中断，原稿已保留';
        setMessages(previous => previous.map(message => message.id === userMessageId ? { ...message, status: 'failed', failure, errorCode: cause.code } : message));
        setError(failure);
      }
    } finally {
      if (request.current === controller) { request.current = null; requestMessage.current = null; setBusy(''); }
    }
  };
  const apply = async () => {
    if (!candidate || request.current || disabled || resolved.problem) return;
    const controller = new AbortController();
    request.current = controller; setBusy('checking'); setError('');
    try {
      const source = latest.current.article;
      const next = mergeAIEdit(candidate.base, candidate.next, source);
      await inspect(next, controller.signal);
      if (controller.signal.aborted || request.current !== controller) return;
      if (latest.current.article !== source) throw new Error('检查期间正文发生变化，请重新点击应用，原稿已保留');
      if (latest.current.disabled) throw new Error('请先结束其他生成或排版试用，再应用本次修改');
      setArticle({ ...next, settings: { ...next.settings, aiEdited: true }, updatedAt: new Date().toISOString() });
      setMessages(previous => previous.map(message => message.id === candidate.messageId ? { ...message, status: 'applied', appliedBase: source, appliedNext: next } : message));
      setCandidate(null); setShowCandidate(true); onApplied();
      setToast('修改已应用，可撤销');
    } catch (cause) { if (!controller.signal.aborted) setError(cause.message || '方案检查失败，原稿已保留'); }
    finally { if (request.current === controller) { request.current = null; setBusy(''); } }
  };
  const revertChange = key => {
    if (!candidate || request.current || !resolved.article) return;
    try {
      const next = revertAIEdit(article, resolved.article, key);
      if (!describeAIEdit(article, next).length) { discard(); return; }
      setCandidate({ ...candidate, base: article, next });
      setError('');
    } catch (cause) { setError(cause.message); }
  };
  return { references, referenceArticle, messages, prompt, setPrompt, busy, error, attachments, attachmentsReady, attachmentBusy, addAttachments, addImageLink, removeAttachment, toggleAttachment, autoApply, setAutoApply, candidate, problem: resolved.problem, changes, invalidReferences, showCandidate, setShowCandidate, previewArticle: showCandidate && !disabled ? resolved.article : null, addReference, removeReference: referenceId => setReferences(previous => previous.filter(reference => reference.id !== referenceId)), submit, retry: (message, withoutImages) => submit(null, { retry: message, withoutImages }), regenerate: () => submit(null, { regenerate: true }), revertChange, stop, discard, apply };
}

export function AIEditPanel({ editor, article, assets, disabled, onLocate }) {
  const end = useRef(null);
  const fileInput = useRef(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState('');
  const hasImages = editor.attachments.some(attachment => attachment.enabled !== false && attachmentImages(attachment).length);
  const addLink = async () => {
    if (!link.trim() || editor.attachmentBusy) return;
    if (await editor.addImageLink(link.trim())) { setLink(''); setLinkOpen(false); }
  };
  const attachDisabled = disabled || Boolean(editor.busy) || editor.attachmentBusy || editor.attachmentsReady === false;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [editor.messages, editor.busy]);
  const pasteAttachments = event => {
    const clipboard = event.clipboardData;
    const files = [...clipboard.files];
    if (!files.length) for (const item of clipboard.items) {
      if (item.kind === 'file') { const file = item.getAsFile(); if (file) files.push(file); }
    }
    if (!files.length) return;
    if (!clipboard.getData('text/plain')) event.preventDefault();
    const extensions = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
    editor.addAttachments(files.map((file, index) => {
      const extension = extensions[file.type];
      return extension && !/\.(jpe?g|png|webp)$/i.test(file.name)
        ? new File([file], `粘贴图片-${index + 1}.${extension}`, { type: file.type, lastModified: file.lastModified }) : file;
    }));
  };
  return <section className="ai-edit-panel" aria-label="AI修改对话">
    <div className="ai-edit-messages" role="log" aria-label="修改对话记录" aria-live="polite" aria-relevant="additions text">
      {!editor.messages.length && <div className="ai-edit-empty"><span className="ai-empty-icon"><Sparkles size={23}/></span><h3>让文章更进一步</h3><p>调整文字、图片或排版。</p><div className="ai-prompt-suggestions">{[...(hasImages ? ['把附件图片插入到合适的位置'] : []), '精简表达，保留关键信息', '优化开头，更快切入主题', '统一段落间距与文字样式'].map(text => <button type="button" key={text} disabled={disabled} onClick={() => editor.setPrompt(text)}>{text}<ArrowUp size={13}/></button>)}</div></div>}
      {editor.messages.map(message => <div key={message.id} className={`ai-edit-message ${message.role}`}><strong>{message.role === 'user' ? '你' : <><Sparkles size={12}/>Weave AI</>}</strong><p>{message.text}</p>{message.referenceCount > 0 && <details className="ai-edit-message-references"><summary>{message.referenceCount} 处引用</summary><div>{message.references?.map((reference, index) => <p key={index}>{reference.text || '图片引用'}</p>)}</div></details>}{message.attachmentNames?.length > 0 && <small>附件：{message.attachmentNames.join('、')}{message.withoutImages ? '（仅文字）' : ''}</small>}{message.status && message.status !== 'answered' && <small className={`ai-message-status ${message.status}`}>{({ pending: message.role === 'user' ? '发送中' : editor.problem ? '方案已失效' : '待应用', applied: '已应用', discarded: '已取消', superseded: '已被后续修改替代', failed: message.failure || '生成失败', stopped: '已停止', reverted: '已撤销' })[message.status]}</small>}{['failed', 'stopped'].includes(message.status) && <div className="ai-message-retry"><button className="text-link" type="button" disabled={Boolean(editor.busy || disabled)} onClick={() => editor.retry(message)}>重试</button>{message.errorCode === 'VISION_UNSUPPORTED' && <button className="text-link" type="button" disabled={Boolean(editor.busy || disabled)} onClick={() => editor.retry(message, true)}>去掉图片后重试</button>}</div>}</div>)}
      {editor.busy && <div className="ai-edit-progress" role="status"><span className="ai-thinking"><i/><i/><i/></span><span>{editor.busy === 'checking' ? '检查改动与布局…' : editor.busy === 'repairing' ? '修复手机布局溢出…' : '生成修改方案…'}</span></div>}
      <div ref={end}/>
    </div>
    {editor.candidate && <div className={`ai-edit-review${editor.problem ? ' is-invalid' : ''}`}>
      <div className="ai-edit-review-title"><span className="review-icon"><Check size={15}/></span><strong>{editor.problem ? '方案已失效' : `${editor.changes.length} 项改动`}</strong><span>未应用</span><button type="button" className="asset-remove" aria-label="取消方案" disabled={Boolean(editor.busy)} onClick={editor.discard}><X size={15}/></button></div>
      {editor.problem ? <p role="alert">{editor.problem}</p> : <div className="ai-edit-change-list">{editor.changes.map((change, index) => <details key={`${change.key}:${index}`}><summary><span>{String(index + 1).padStart(2, '0')}</span>{change.label}</summary><div><label>修改前</label><p className="change-before">{change.before || '空'}</p><label>修改后</label><p className="change-after">{change.after || '空'}</p><div className="ai-change-actions">{change.key !== 'layout' && <button type="button" className="text-link" onClick={() => onLocate?.(change.key)}>定位</button>}<button type="button" className="text-link" disabled={Boolean(editor.busy)} onClick={() => editor.revertChange(change.key)}>撤回此处</button></div></div></details>)}</div>}
      <div className="ai-edit-review-actions"><button type="button" className="ghost-action" disabled={Boolean(editor.problem)} aria-pressed={!editor.showCandidate} onClick={() => editor.setShowCandidate(value => !value)}>{editor.showCandidate ? '查看原稿' : '预览方案'}</button><button type="button" className="publish-action" aria-label="应用本次修改" disabled={Boolean(editor.busy || editor.problem || disabled)} onClick={editor.apply}>{editor.busy === 'checking' ? <RefreshCw size={14} className="spin"/> : <Check size={14}/>}应用修改</button></div>
      <div className="ai-edit-followups"><button className="text-link" type="button" disabled={Boolean(editor.busy || disabled)} onClick={editor.regenerate}>换一个方案</button>{['再紧凑些', '只调排版不改字'].map(text => <button className="text-link" type="button" key={text} disabled={Boolean(editor.busy || disabled)} onClick={() => editor.setPrompt(text)}>{text}</button>)}</div>
    </div>}
    {disabled && <p className="ai-edit-error" role="status">请先结束当前生成或排版预览。</p>}
    {editor.error && <div className="ai-edit-error" role="alert"><p>{editor.error}</p></div>}
    <form className="ai-edit-composer" onSubmit={editor.submit} onPaste={pasteAttachments}>
      {editor.references.length > 0 && <div className="ai-edit-references" aria-label="关注内容引用">{editor.references.map(reference => {
        const valid = validAIReference(editor.referenceArticle, reference);
        const asset = assets.get(reference.assetId);
        return <div className={`ai-edit-reference${valid ? '' : ' is-invalid'}`} key={reference.id}>
          {reference.kind === 'image' && (asset ? <img src={asset.previewUrl || asset.cacheUrl || asset.url} alt="引用图片缩略图"/> : <Image size={22}/>)}
          <div><span>{valid ? reference.kind === 'image' ? '图片' : '文字' : '已失效'}</span><p title={reference.text}>{reference.text}</p></div><button type="button" className="ai-edit-reference-remove" aria-label={`移除引用：${reference.text.slice(0, 20)}`} onClick={() => editor.removeReference(reference.id)}><X size={12}/></button>
        </div>;
      })}</div>}
      {editor.attachments?.length > 0 && <div className="ai-edit-attachments" aria-label="已添加附件">{editor.attachments.map(attachment => <div className={`ai-edit-attachment${attachment.kind === 'image' ? ' is-image' : ''}`} key={attachment.id}>
        <input type="checkbox" aria-label={`本轮使用附件：${attachment.name}`} checked={attachment.enabled !== false} disabled={Boolean(editor.busy)} onChange={() => editor.toggleAttachment(attachment.id)}/>
        {attachment.kind === 'image' ? <img className="ai-edit-attachment-thumb" src={attachment.previewUrl} alt="附件图片预览"/> : <span className="ai-edit-attachment-icon"><FileText size={17}/></span>}
        <div className="ai-edit-attachment-meta"><strong title={attachment.name}>{attachment.name}</strong><small>{attachment.kind === 'image' ? [attachment.sourceUrl ? '链接图片' : '图片', attachment.width && `${attachment.width}×${attachment.height}`].filter(Boolean).join(' · ') : `${attachment.charCount.toLocaleString()} 字${attachment.images?.length ? ` · ${attachment.images.length} 张图片` : ''}`}</small></div>
        {attachment.kind === 'document' && attachment.images?.length > 0 && <div className="ai-edit-attachment-images" aria-label="文档内嵌图片">{attachment.images.slice(0, 3).map(image => <img key={image.assetId} src={image.previewUrl} alt="文档内嵌图片预览"/>)}{attachment.images.length > 3 && <small>+{attachment.images.length - 3}</small>}</div>}
        <button type="button" className="ai-edit-reference-remove" aria-label={`移除附件：${attachment.name}`} title="移除附件" disabled={Boolean(editor.busy)} onClick={() => editor.removeAttachment(attachment.id)}><X size={12}/></button>
      </div>)}</div>}
      <input ref={fileInput} className="ai-edit-file-input" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp,.pdf,.docx,.txt,.md" onChange={event => { editor.addAttachments(event.target.files); event.target.value = ''; }}/>
      {linkOpen && <div className="ai-edit-link">
        <Link2 size={13}/>
        <input type="url" aria-label="图片链接" autoFocus value={link} disabled={editor.attachmentBusy} spellCheck={false} placeholder="粘贴 HTTPS 图片直链" onChange={event => setLink(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addLink(); } else if (event.key === 'Escape') setLinkOpen(false); }}/>
        <button type="button" className="ai-edit-link-add" disabled={attachDisabled || !link.trim()} onClick={addLink}>{editor.attachmentBusy ? <RefreshCw size={12} className="spin"/> : '添加'}</button>
        <button type="button" className="ai-edit-link-close" aria-label="收起图片链接" disabled={editor.attachmentBusy} onClick={() => setLinkOpen(false)}><X size={12}/></button>
      </div>}
      <label className="ai-edit-auto-apply"><input type="checkbox" checked={editor.autoApply} disabled={Boolean(editor.busy)} onChange={event => editor.setAutoApply(event.target.checked)}/>校验通过后直接应用</label>
      <textarea aria-label="AI修改要求" value={editor.prompt} disabled={disabled} onChange={event => editor.setPrompt(event.target.value)} maxLength={4000} rows={3} placeholder={editor.candidate ? '继续调整方案…' : hasImages ? '例如：把图片放到合适的位置' : '你想如何调整？'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); editor.submit(); } }}/>
      <div className="ai-edit-composer-footer"><div className="ai-edit-composer-tools"><button className="ai-edit-upload" type="button" aria-label="上传图片或文档" title="上传图片或文档" disabled={attachDisabled} onClick={() => fileInput.current?.click()}><Paperclip size={16}/></button><button className={`ai-edit-upload${linkOpen ? ' on' : ''}`} type="button" aria-label="添加图片链接" aria-expanded={linkOpen} title="添加图床图片链接" disabled={attachDisabled} onClick={() => setLinkOpen(value => !value)}><Link2 size={16}/></button></div><span>Enter 发送 · Shift + Enter 换行</span>{editor.busy ? <button className="ai-edit-send stop" type="button" onClick={editor.stop} aria-label="停止生成"><Square size={13}/></button> : <button className="ai-edit-send" type="submit" aria-label="发送修改要求" disabled={disabled || editor.attachmentBusy || editor.attachmentsReady === false || !editor.prompt.trim() || editor.invalidReferences.length > 0 || Boolean(editor.problem)}><ArrowUp size={18}/></button>}</div>
      {editor.attachmentBusy && <p className="ai-edit-upload-progress" role="status"><RefreshCw size={12} className="spin"/>{linkOpen ? '正在读取图片链接…' : '正在处理附件…'}</p>}
      {editor.invalidReferences.length > 0 && <p className="ai-edit-reference-warning" role="status">请移除失效引用后重选。</p>}
    </form>
  </section>;
}
