import { useEffect, useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import { templates } from './templates';
import { renderArticle } from './renderer';
import { describeTemplateFit } from './recommender';
import { TemplateThumb, previewDocument } from './TemplateThumb';

export function TemplateLibrary({ article, template, assets, recs, selected, chooseTemplate, onCancel, onApply }) {
  const [libraryView, setLibraryView] = useState('templates');
  const [query, setQuery] = useState('');
  const [series, setSeries] = useState('全部');
  const preview = useMemo(() => renderArticle({ ...article, html: undefined, layoutDesign: undefined }, template, assets, { mode: 'preview' }).html, [article, template, assets]);
  const filtered = templates.filter(t =>
    (series === '全部' || t.series === series) &&
    query.trim().toLowerCase().split(/\s+/).every(term =>
      `${t.id} ${t.name} ${t.series} ${t.visual} ${t.fit.description || ''} ${t.styleTags.join(' ')}`.toLowerCase().includes(term)));
  useEffect(() => {
    const close = event => { if (event.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onCancel]);
  return (
    <div className="modal-backdrop library-backdrop" onClick={onCancel}>
      <div className="library-modal" role="dialog" aria-modal="true" aria-labelledby="library-title" onClick={(e) => e.stopPropagation()}>
        <header>
          <div>

            <h2 id="library-title">为这篇文章选择版式</h2>
            <p className="library-intro">点击模板，预览当前文章。</p>
          </div>
          <button className="icon-action" onClick={onCancel} aria-label="关闭模板库并取消试用">
            <X size={19} />
          </button>
        </header>
        <div className="library-tools">
          <div className="search-field">
            <Search size={16} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索名称、编号、风格或用途"
              aria-label="搜索模板"
              autoFocus
            />
          </div>
          <div className="series-tabs">
            {["全部", ...new Set(templates.map(t => t.series))].map((s) => (
              <button
                key={s}
                className={series === s ? "selected" : ""}
                onClick={() => setSeries(s)}
                aria-pressed={series === s}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="library-view-switch">
          <button className={libraryView === "templates" ? "selected" : ""} aria-pressed={libraryView === "templates"} onClick={() => setLibraryView("templates")}>模板 · {filtered.length}</button>
          <button className={libraryView === "preview" ? "selected" : ""} aria-pressed={libraryView === "preview"} onClick={() => setLibraryView("preview")}>文章预览</button>
        </div>
        <div className={`library-workspace view-${libraryView}`}>
          <div className="library-catalog">
            <div className="library-result-count">{filtered.length} 套模板</div>
            <div className="library-grid">
              {filtered.map((t) => (
                <button
                  key={t.id}
                  className={selected === t.id ? "library-card active" : "library-card"}
                  aria-pressed={selected === t.id}
                  onClick={() => {
                    chooseTemplate(t.id);
                    setLibraryView("preview");
                  }}
                >
                  <TemplateThumb article={article} template={t} assets={assets} large />
                  <span className="library-card-title">
                    <strong>{t.name}</strong>
                    <small>{t.id}</small>
                  </span>
                  <span className="template-tags">{t.styleTags.map(tag => <span key={tag}>{tag}</span>)}</span>
                  <small className="library-card-purpose">{t.fit.description || t.series}</small>
                  <small className="library-card-fit">{describeTemplateFit(article, t)}</small>
                  {recs.some(recommended => recommended.id === t.id) && <span className="library-recommended">适合当前文章</span>}
                </button>
              ))}
              {filtered.length === 0 && (
                <p className="empty-result">暂无匹配模板</p>
              )}
            </div>
          </div>
          <aside className="library-inspector">
            <div className="library-preview-heading" aria-live="polite">
              <span className="eyebrow">预览</span>
              <strong>{template.name}<small>{template.id}</small></strong>
              <p>{template.visual}</p>
              <small>{describeTemplateFit(article, template)}</small>
            </div>
            <div className="library-live-preview">
              <iframe
                title={`${template.name}完整文章预览`}
                srcDoc={previewDocument(preview)}
                sandbox="allow-same-origin"
              />
            </div>
          </aside>
        </div>
        <footer>
          <span className="library-selection">已选 <strong>{template.name}</strong></span>
          <button className="ghost-action" onClick={onCancel}>
            取消
          </button>
          <button className="publish-action" onClick={onApply}>
            使用此模板
          </button>
        </footer>
      </div>
    </div>
  );
}
