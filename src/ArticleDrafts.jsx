import { Trash2 } from 'lucide-react';

const modifiedTime = value => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });

export function ArticleDrafts({ records, onOpen, onDelete, disabled }) {
  if (!records.length) return null;
  return <section className="article-drafts" aria-labelledby="article-drafts-title">
    <div className="section-caption"><h2 id="article-drafts-title">未完成草稿 <span>{records.length}</span></h2><span>30 天未修改自动删除 · 图片保留 7 天</span></div>
    <ul>{records.map(record => <li key={record.id}>
      <div className="article-draft-meta"><strong title={record.article.title}>{record.article.title || '未命名文章'}</strong><time dateTime={new Date(record.updatedAt).toISOString()}>修改于 {modifiedTime(record.updatedAt)}</time></div>
      <button className="text-link" disabled={disabled} onClick={() => onOpen(record.id)}>继续编辑</button>
      <button className="icon-action article-draft-delete" disabled={disabled} title="删除草稿" aria-label={`删除草稿：${record.article.title || '未命名文章'}`} onClick={() => { if (window.confirm('删除这篇未完成草稿？此操作无法撤销，手动保存的历史记录仍会保留。')) onDelete(record.id); }}><Trash2 size={15}/></button>
    </li>)}</ul>
  </section>;
}
