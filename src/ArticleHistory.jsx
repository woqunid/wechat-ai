import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { deleteArticleHistory, listArticleHistory } from './storage.js';

const savedTime = value => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const draftTime = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function ArticleHistory({ onClose, onOpen, setToast, drafts, onOpenDraft, onDeleteDraft }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const dialog = useRef(null);
  const close = useRef(onClose);
  const showDrafts = Array.isArray(drafts);
  const [view, setView] = useState(showDrafts ? 'drafts' : 'saved');
  const draftTab = useRef(null);
  const savedTab = useRef(null);
  close.current = onClose;
  const load = async () => {
    try { setRecords(await listArticleHistory()); setError(''); }
    catch { setError('历史记录读取失败'); }
  };
  useEffect(() => {
    let active = true;
    const refresh = () => listArticleHistory().then(values => { if (active) { setRecords(values); setError(''); } }).catch(() => { if (active) setError('历史记录读取失败'); });
    refresh();
    const timer = setInterval(refresh, 60_000);
    const previous = document.activeElement;
    dialog.current.querySelector('button').focus();
    const keydown = event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close.current(); }
      if (event.key !== 'Tab') return;
      const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (!dialog.current.contains(document.activeElement)) { event.preventDefault(); first.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => { active = false; clearInterval(timer); document.removeEventListener('keydown', keydown); if (previous?.isConnected) previous.focus(); };
  }, []);
  const open = async record => {
    if (busy) return;
    setBusy(record.id);
    try {
      const current = (await listArticleHistory()).find(value => value.id === record.id);
      if (!current) { await load(); throw new Error('历史记录已过期或被删除'); }
      await onOpen(current);
    } catch (cause) { setToast(cause.message || '历史记录打开失败'); }
    finally { setBusy(null); }
  };
  const openDraft = async record => {
    if (busy || !onOpenDraft) return;
    setBusy(record.id);
    try { await onOpenDraft(record.id); }
    catch (cause) { setToast(cause.message || '草稿打开失败'); }
    finally { setBusy(null); }
  };
  const remove = async record => {
    if (busy) return;
    setBusy(record.id);
    try {
      await deleteArticleHistory(record.id);
      setRecords(values => values.filter(value => value.id !== record.id));
    } catch { setToast('历史记录删除失败'); }
    finally { setBusy(null); }
  };
  const removeDraft = async record => {
    if (busy || !onDeleteDraft || !window.confirm('删除这篇未完成草稿？此操作无法撤销，手动保存的历史记录仍会保留。')) return;
    setBusy(record.id);
    try { await onDeleteDraft(record.id); }
    catch (cause) { setToast(cause.message || '草稿删除失败'); }
    finally { setBusy(null); }
  };
  const switchTab = (event, next) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const selected = next === 'drafts' ? 'saved' : 'drafts';
    setView(selected);
    (selected === 'drafts' ? draftTab : savedTab).current.focus();
  };
  const savedContent = error ? <div className="article-history-empty" role="status">{error}<button className="text-link" onClick={load}>重试</button></div> : records === null ? <div className="article-history-empty" role="status">加载中…</div> : records.length ? <ul>{records.map(record => <li key={record.id}>
    <div className="article-history-meta"><strong title={record.title}>{record.title}</strong><time dateTime={new Date(record.savedAt).toISOString()}>{savedTime(record.savedAt)}</time></div>
    <div className="article-history-row-actions">
      <button className="text-link" disabled={Boolean(busy)} onClick={() => open(record)}>查看/修改</button>
      <button className="icon-action article-history-delete" title="删除" aria-label={`删除${record.title}`} disabled={Boolean(busy)} onClick={() => remove(record)}><Trash2 size={16}/></button>
    </div>
  </li>)}</ul> : <div className="article-history-empty">暂无已保存历史</div>;
  return <div className="modal-backdrop" onClick={onClose}>
    <section ref={dialog} className="small-modal article-history-modal" role="dialog" aria-modal="true" aria-labelledby="article-history-title" onClick={event => event.stopPropagation()}>
      <button className="modal-close" aria-label="关闭历史记录" onClick={onClose}><X size={18}/></button>
      <h2 id="article-history-title">历史记录</h2>
      <p className="article-history-retention">{showDrafts ? '草稿 30 天未修改自动删除；已保存历史保留 30 天，图片保留 30 天。' : '历史记录保留 30 天，图片保留 30 天。'}</p>
      {showDrafts && <div className="article-history-tabs" role="tablist" aria-label="历史记录类型">
        <button ref={draftTab} id="article-drafts-tab" type="button" role="tab" aria-selected={view === 'drafts'} aria-controls="article-drafts-panel" tabIndex={view === 'drafts' ? 0 : -1} onClick={() => setView('drafts')} onKeyDown={event => switchTab(event, 'drafts')}>未完成草稿 <span>{drafts.length}</span></button>
        <button ref={savedTab} id="article-saved-tab" type="button" role="tab" aria-selected={view === 'saved'} aria-controls="article-saved-panel" tabIndex={view === 'saved' ? 0 : -1} onClick={() => setView('saved')} onKeyDown={event => switchTab(event, 'saved')}>已保存历史 <span>{records?.length ?? '…'}</span></button>
      </div>}
      <div className="article-history-list" aria-busy={Boolean(busy)}>
        {showDrafts && <section className="article-history-group" role="tabpanel" id="article-drafts-panel" aria-labelledby="article-drafts-tab" tabIndex={0} hidden={view !== 'drafts'}>
          {drafts.length ? <ul>{drafts.map(record => <li key={record.id}>
            <div className="article-history-meta"><strong title={record.article.title}>{record.article.title || '未命名文章'}</strong><time dateTime={new Date(record.updatedAt).toISOString()}>修改于 {draftTime(record.updatedAt)}</time></div>
            <div className="article-history-row-actions">
              <button className="text-link" disabled={Boolean(busy)} onClick={() => openDraft(record)}>继续编辑</button>
              <button className="icon-action article-history-delete" title="删除草稿" aria-label={`删除草稿：${record.article.title || '未命名文章'}`} disabled={Boolean(busy)} onClick={() => removeDraft(record)}><Trash2 size={16}/></button>
            </div>
          </li>)}</ul> : <div className="article-history-empty">暂无未完成草稿</div>}
        </section>}
        {showDrafts ? <section className="article-history-group" role="tabpanel" id="article-saved-panel" aria-labelledby="article-saved-tab" tabIndex={0} hidden={view !== 'saved'}>{savedContent}</section> : <section className="article-history-group">
          <h3 id="article-saved-title">已保存历史{records && <span>{records.length}</span>}</h3>{savedContent}
        </section>}
      </div>
    </section>
  </div>;
}
