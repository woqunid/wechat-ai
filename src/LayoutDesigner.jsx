import { useEffect, useRef, useState } from 'react';
import { ArrowRight, RefreshCw, WandSparkles, X } from 'lucide-react';
import { clearArticleStyles, layoutLeaves, layoutSignature, layoutSource, LAYOUT_TIMEOUT_MS, validateLayoutDesign } from './layout-design.js';
import { renderArticle } from './renderer.js';
import { getTemplate } from './templates.js';
import { inspectLayoutPreview } from './layout-preview.js';

export function LayoutDesigner({ article, setArticle, aiRequest, onTrial, resetKey, disabled, setToast }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('auto');
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [candidate, setCandidate] = useState(null);
  const request = useRef(null);
  const dialog = useRef(null);
  const latest = useRef(article);
  latest.current = article;
  const signature = layoutSignature(article);
  const close = () => { request.current?.abort(); setOpen(false); };
  const cancelTrial = () => { setCandidate(null); onTrial(null); };
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    request.current?.abort();
    setOpen(false);
    setCandidate(null);
    onTrial(null);
  }, [resetKey, onTrial]);
  useEffect(() => {
    if (candidate && candidate.signature !== signature) {
      cancelTrial();
      setToast('正文已变化，试用方案已取消，可根据新内容重新设计');
    }
  }, [signature, candidate]);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    const key = event => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
      if (event.key === 'Tab') {
        const controls = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
        const first = controls[0], last = controls.at(-1);
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus({ preventScroll: true }); };
  }, [open]);
  const generate = async event => {
    event.preventDefault();
    if (busy || disabled || (mode === 'prompt' && !prompt.trim())) return;
    const sourceArticle = latest.current;
    const sourceSignature = layoutSignature(sourceArticle);
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    setError('');
    cancelTrial();
    try {
      const response = await fetch('/api/articles/design', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ article: { title: sourceArticle.title, summary: sourceArticle.summary, blocks: sourceArticle.blocks }, mode, prompt: mode === 'prompt' ? prompt.trim() : '', ...aiRequest }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(LAYOUT_TIMEOUT_MS + 10_000)]),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || '新版式生成失败，请重试');
      const design = validateLayoutDesign(data.design, sourceArticle);
      const html = renderArticle({ ...clearArticleStyles(sourceArticle), layoutDesign: design }, getTemplate(sourceArticle.templateId), new Map(), { mode: 'preview' }).html;
      await inspectLayoutPreview(html, controller.signal);
      if (controller.signal.aborted) return;
      if (layoutSignature(latest.current) !== sourceSignature) throw new Error('设计期间正文已变化，请根据新内容重新设计');
      const next = { design, signature: sourceSignature };
      setCandidate(next);
      onTrial(next);
      setOpen(false);
      setToast('新版式已通过手机适配检查，正在中间预览区试用');
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause.name === 'TimeoutError' ? '设计超时，当前排版已保留，请重试' : cause.message || '设计失败，当前排版已保留');
    } finally {
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  const apply = () => {
    if (layoutSignature(latest.current) !== candidate.signature) { cancelTrial(); setToast('正文已变化，请重新设计'); return; }
    setArticle(current => layoutSignature(current) === candidate.signature ? { ...clearArticleStyles(current), layoutDesign: candidate.design, updatedAt: new Date().toISOString() } : current);
    cancelTrial();
    setToast('排版已应用，可撤销');
  };
  const changedStructure = article.layoutDesign && JSON.stringify(layoutLeaves(article.layoutDesign.nodes).map(node => node.ref)) !== JSON.stringify(layoutSource(article).map(item => item.ref));
  return <>
    <div className={`layout-designer-card${candidate ? ' is-reviewing' : ''}`}>
      <div className="layout-designer-title"><WandSparkles size={17} /><strong>{candidate ? '排版预览' : 'AI 排版'}</strong><span>{candidate ? '待应用' : '自定义'}</span></div>
      {candidate ? <>
        <h3>{candidate.design.name}</h3>
        <p>{candidate.design.description}</p>
        <small>已通过手机适配检查</small>
        <div className="layout-review-actions"><button className="publish-action" onClick={apply}>应用排版</button><button className="ghost-action" onClick={cancelTrial}>取消</button></div>
        <button className="text-link" disabled={disabled} onClick={() => { setError(''); setOpen(true); }}>重新设计</button>
      </> : <>
        <p>为文章定制专属版式</p>
        <button className="layout-design-start" disabled={disabled} onClick={() => { setError(''); setOpen(true); }}>开始设计<ArrowRight size={15} /></button>
        {changedStructure && <small>内容结构已变化，已沿用样式；重新设计可优化分组。</small>}
      </>}
    </div>
    {open && <div className="modal-backdrop" onClick={close}>
      <form ref={dialog} className="small-modal layout-design-modal" role="dialog" aria-modal="true" aria-labelledby="layout-design-title" tabIndex={-1} onClick={event => event.stopPropagation()} onSubmit={generate}>
        <button className="modal-close" type="button" onClick={close} aria-label="关闭定制排版"><X size={19} /></button>
        <span className="eyebrow">AI 排版</span>
        <h2 id="layout-design-title">为这篇文章开始设计</h2>
        <p>保留文字与图片，重新设计版式。</p>
        <fieldset className="layout-design-modes" disabled={busy}>
          <legend>设计方式</legend>
          <label className={mode === 'auto' ? 'selected' : ''}><input type="radio" name="design-mode" value="auto" checked={mode === 'auto'} onChange={() => setMode('auto')} /><span><strong>自动设计</strong><small>根据文章匹配风格</small></span></label>
          <label className={mode === 'prompt' ? 'selected' : ''}><input type="radio" name="design-mode" value="prompt" checked={mode === 'prompt'} onChange={() => setMode('prompt')} /><span><strong>指定风格</strong><small>描述你希望的视觉效果</small></span></label>
        </fieldset>
        {mode === 'prompt' && <label className="layout-prompt-label">风格要求<textarea value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} maxLength={1000} rows={4} required placeholder="例如：简洁杂志风，突出重点，减少装饰。" /><small>{prompt.length}/1000</small></label>}
        <div className="layout-design-note">生成后可预览，确认后应用。</div>
        {error && <p className="layout-design-error" role="alert">{error}</p>}
        {busy && <p className="layout-design-progress" role="status"><RefreshCw size={15} className="spin" />正在设计并检查适配…</p>}
        <div className="modal-buttons"><button className="ghost-action" type="button" onClick={close}>{busy ? '取消生成' : '取消'}</button><button className="publish-action" type="submit" disabled={busy || (mode === 'prompt' && !prompt.trim())}><WandSparkles size={15} />{busy ? '正在设计' : '生成新版式'}</button></div>
      </form>
    </div>}
  </>;
}
