import { useEffect, useMemo, useRef, useState } from 'react';
import { renderArticle } from './renderer';

export const previewDocument = html => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><style>*{box-sizing:border-box}html,body{margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}p{overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;

export function TemplateThumb({ article, template, assets, large = false }) {
  const container = useRef();
  const [scale, setScale] = useState(large ? 0.5 : 0.2);
  const html = useMemo(() => renderArticle(
    { ...article, html: undefined, layoutDesign: undefined, blocks: article.blocks.slice(0, 12) },
    template,
    assets,
    { mode: "preview" },
  ).html, [article, template, assets]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / 375);
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      ref={container}
      className={`template-mini theme-${template.seriesId}${large ? " large" : ""}`}
      aria-label={`${template.name}预览`}
      style={{ backgroundColor: template.tokens.page || "#ffffff" }}
    >
      <iframe
        className="thumb-content"
        title={`${template.name}文章缩略图`}
        srcDoc={previewDocument(html)}
        sandbox="allow-same-origin"
        tabIndex={-1}
        aria-hidden="true"
        loading="lazy"
        style={{ transform: `scale(${scale})` }}
      />
    </div>
  );
}
