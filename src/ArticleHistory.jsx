import { useEffect, useRef, useState } from 'react';
import { Trash2, X } from 'lucide-react';
import { deleteArticleHistory, listArticleHistory } from './storage.js';

const savedTime = value => new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function ArticleHistory({ onClose, onOpen, setToast }) {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(null);
  const dialog = useRef(null);
  const close = useRef(onClose);
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
  const remove = async record => {
    if (busy) return;
    setBusy(record.id);
    try {
      await deleteArticleHistory(record.id);
      setRecords(values => values.filter(value => value.id !== record.id));
    } catch { setToast('历史记录删除失败'); }
    finally { setBusy(null); }
  };
  return <div className="modal-backdrop" onClick={onClose}>
    <section ref={dialog} className="small-modal article-history-modal" role="dialog" aria-modal="true" aria-labelledby="article-history-title" onClick={event => event.stopPropagation()}>
      <button className="modal-close" aria-label="关闭历史记录" onClick={onClose}><X size={18}/></button>
      <h2 id="article-history-title">历史记录</h2>
      <p className="article-history-retention">图片保留 7 天，历史记录保留 30 天，到期自动删除。</p>
      <div className="article-history-list" aria-busy={Boolean(busy)}>
        {error ? <div className="article-history-empty" role="status">{error}<button className="text-link" onClick={load}>重试</button></div> : records === null ? <div className="article-history-empty" role="status">加载中…</div> : records.length === 0 ? <div className="article-history-empty">暂无历史记录</div> : <ul>
          {records.map(record => <li key={record.id}>
            <div className="article-history-meta"><strong title={record.title}>{record.title}</strong><time dateTime={new Date(record.savedAt).toISOString()}>{savedTime(record.savedAt)}</time></div>
            <div className="article-history-row-actions">
              <button className="text-link" disabled={Boolean(busy)} onClick={() => open(record)}>查看/修改</button>
              <button className="icon-action article-history-delete" title="删除" aria-label={`删除${record.title}`} disabled={Boolean(busy)} onClick={() => remove(record)}><Trash2 size={16}/></button>
            </div>
          </li>)}
        </ul>}
      </div>
    </section>
  </div>;
}
