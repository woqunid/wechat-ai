import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, Image, MessageSquare, RefreshCw, Square, X } from 'lucide-react';
import { uid } from './core.js';
import { AIEditResponseSchema, AI_EDIT_TIMEOUT_MS, buildAIEdit, createAIReference, describeAIEdit, mergeAIEdit, sameAIReference, validAIReference } from './ai-edit.js';
import { renderArticle } from './renderer.js';
import { getTemplate } from './templates.js';
import { inspectLayoutPreview } from './layout-preview.js';

export function useAIEdit({ article, setArticle, assets, disabled, onApplied, setToast }) {
  const [references, setReferences] = useState([]);
  const [messages, setMessages] = useState([]);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState(null);
  const [showCandidate, setShowCandidate] = useState(true);
  const request = useRef(null);
  const latest = useRef(null);
  latest.current = { article, references, disabled, assets };
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    setReferences([]); setMessages([]); setPrompt(''); setBusy(''); setError(''); setCandidate(null); setShowCandidate(true);
    return () => { request.current?.abort(); request.current = null; };
  }, [article.id]);

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
  const submit = async event => {
    event?.preventDefault();
    if (request.current || disabled || !prompt.trim()) return;
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
    setMessages(previous => [...previous, { id: uid('msg'), role: 'user', text: instruction, referenceCount: selected.length }]);
    try {
      const response = await fetch('/api/articles/edit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: working, prompt: instruction, references: selected.map(({ snapshot, assetId, ...reference }) => reference), messages: messages.slice(-16).map(message => ({ role: message.role, text: message.text.slice(0, 4000) })) }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(AI_EDIT_TIMEOUT_MS + 10000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.code === 'NOT_FOUND' ? 'AI修改接口尚未启动，请重启后端服务' : data.error?.message || '修改方案生成失败');
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
      setMessages(previous => [...previous.map(message => changed && message.id === candidate?.messageId ? { ...message, status: 'superseded' } : message), { id: messageId, role: 'assistant', text: result.message, ...(changed && hasChanges ? { status: 'pending' } : {}) }]);
      if (changed) { setCandidate(hasChanges ? { base: original, next, references: selected, messageId } : null); setShowCandidate(true); }
    } catch (cause) {
      if (!controller.signal.aborted && request.current === controller) setError(cause.name === 'TimeoutError' ? '修改方案生成超时，原稿已保留，可重新发送' : cause.message || '网络中断，原稿已保留');
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
      setToast('AI修改已应用，可通过正文区的撤销整体恢复');
    } catch (cause) { if (!controller.signal.aborted) setError(cause.message || '方案检查失败，原稿已保留'); }
    finally { if (request.current === controller) { request.current = null; setBusy(''); } }
  };
  return { references, messages, prompt, setPrompt, busy, error, candidate, problem: resolved.problem, changes, invalidReferences, showCandidate, setShowCandidate, previewArticle: showCandidate && !disabled ? resolved.article : null, addReference, removeReference: referenceId => setReferences(previous => previous.filter(reference => reference.id !== referenceId)), submit, stop, discard, apply };
}

export function AIEditPanel({ editor, article, assets, disabled, onLocate }) {
  const end = useRef(null);
  const lastInstruction = editor.messages.findLast(message => message.role === 'user')?.text;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [editor.messages, editor.busy]);
  return <section className="ai-edit-panel" aria-label="AI修改对话">
    <div className="ai-edit-context"><span>全文已作为上下文</span><small>引用用于提示关注点，修改前由你确认</small></div>
    <div className="ai-edit-messages" role="log" aria-label="修改对话记录" aria-live="polite" aria-relevant="additions text">
      {!editor.messages.length && <div className="ai-edit-empty"><MessageSquare size={24}/><h3>一起调整这篇文章</h3><p>选中文字或图片，会自动添加到下方。也可以直接描述整篇文章需要怎样调整。</p><p>例如：把开头写得更直接，缩小第二张图片，并调整附近的留白。</p></div>}
      {editor.messages.map(message => <div key={message.id} className={`ai-edit-message ${message.role}`}><strong>{message.role === 'user' ? '你' : 'AI'}</strong><p>{message.text}</p>{message.referenceCount > 0 && <small>关注 {message.referenceCount} 处引用</small>}{message.status && <small>{({ pending: editor.problem ? '方案已失效' : '方案待确认', applied: '已应用 · 可撤销', discarded: '已取消', superseded: '已被后续方案替代' })[message.status]}</small>}</div>)}
      {editor.busy && <p className="ai-edit-progress" role="status"><RefreshCw className="spin" size={14}/>{editor.busy === 'checking' ? '正在检查布局与修改范围…' : '正在读取全文并生成修改方案…'}</p>}
      <div ref={end}/>
    </div>
    {editor.candidate && <div className={`ai-edit-review${editor.problem ? ' is-invalid' : ''}`}>
      <div className="ai-edit-review-title"><strong>{editor.problem ? '方案已失效' : `待确认 · ${editor.changes.length} 项改动`}</strong><span>尚未写入正文</span></div>
      {editor.problem ? <p role="alert">{editor.problem}</p> : <div className="ai-edit-change-list">{editor.changes.map((change, index) => <details key={`${change.key}:${index}`}><summary>{change.label}</summary><div><label>修改前</label><p>{change.before || '空'}</p><label>修改后</label><p>{change.after || '空'}</p>{change.key !== 'layout' && <button type="button" className="text-link" onClick={() => onLocate(change.key)}>查看位置</button>}</div></details>)}</div>}
      <div className="ai-edit-review-actions"><button type="button" className="ghost-action" disabled={Boolean(editor.problem)} aria-pressed={!editor.showCandidate} onClick={() => editor.setShowCandidate(value => !value)}>{editor.showCandidate ? '查看原稿' : '预览方案'}</button><button type="button" className="publish-action" disabled={Boolean(editor.busy || editor.problem || disabled)} onClick={editor.apply}><Check size={14}/>应用本次修改</button></div>
      <button type="button" className="text-link" disabled={Boolean(editor.busy)} onClick={editor.discard}>取消方案</button>
    </div>}
    {disabled && <p className="ai-edit-error" role="status">请先完成或取消其他文章生成、模板或定制排版试用。</p>}
    {editor.error && <div className="ai-edit-error" role="alert"><p>{editor.error}</p>{lastInstruction && !editor.prompt && <button className="text-link" type="button" onClick={() => editor.setPrompt(lastInstruction)}>填回上次要求</button>}</div>}
    <form className="ai-edit-composer" onSubmit={editor.submit}>
      {editor.references.length > 0 && <div className="ai-edit-references" aria-label="关注内容引用">{editor.references.map(reference => {
        const valid = validAIReference(article, reference);
        const asset = assets.get(reference.assetId);
        return <div className={`ai-edit-reference${valid ? '' : ' is-invalid'}`} key={reference.id}>
          <button type="button" className="ai-edit-reference-remove" aria-label={`移除引用：${reference.text.slice(0, 20)}`} onClick={() => editor.removeReference(reference.id)}><X size={12}/></button>
          {reference.kind === 'image' && (asset ? <img src={asset.previewUrl || asset.cacheUrl || asset.url} alt="引用图片缩略图"/> : <Image size={22}/>)}
          <p title={reference.text}>{reference.text}</p><span>{valid ? reference.kind === 'image' ? '图片' : '文字' : '已失效 · 点击×移除'}</span>
        </div>;
      })}</div>}
      <textarea aria-label="AI修改要求" value={editor.prompt} onChange={event => editor.setPrompt(event.target.value)} maxLength={4000} rows={3} placeholder={editor.candidate ? '继续调整当前方案…' : '描述你想修改的内容或排版…'} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); editor.submit(); } }}/>
      <div className="ai-edit-composer-footer"><span>{editor.references.length ? `${editor.references.length}处关注 · 全文上下文` : '全文上下文'}<small>会话仅在本次编辑中保留</small></span>{editor.busy ? <button className="ai-edit-send stop" type="button" onClick={editor.stop} aria-label="停止生成"><Square size={14}/></button> : <button className="ai-edit-send" type="submit" aria-label="发送修改要求" disabled={disabled || !editor.prompt.trim() || editor.invalidReferences.length > 0 || Boolean(editor.problem)}><ArrowUp size={18}/></button>}</div>
      {editor.invalidReferences.length > 0 && <p className="ai-edit-reference-warning" role="status">引用已失效，请移除后重新选择。</p>}
    </form>
  </section>;
}
