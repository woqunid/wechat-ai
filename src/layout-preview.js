export async function inspectLayoutPreview(html, signal) {
  const overflow = (width, detail) => {
    const error = new Error(`${width}px 预览出现横向溢出：${detail}；请调整宽度、留白或换行，保留原有内容`);
    error.code = 'LAYOUT_OVERFLOW';
    throw error;
  };
  const frame = document.createElement('iframe');
  frame.title = '版式适配检查';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:800px;border:0;visibility:hidden;';
  try {
    await new Promise((resolve, reject) => {
      const finish = error => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        frame.onload = null;
        error ? reject(error) : resolve();
      };
      const abort = () => finish(new DOMException('已取消', 'AbortError'));
      const timer = setTimeout(() => finish(new Error('预览检查超时，请重新生成')), 6000);
      frame.onload = () => finish();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) { abort(); return; }
      frame.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;padding:0}p{overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
      document.body.appendChild(frame);
    });
    for (const width of [320, 375, 414]) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      frame.style.width = `${width}px`;
      const doc = frame.contentDocument;
      if (!doc?.body) throw new Error('无法读取版式预览，请重新生成');
      const viewportWidth = doc.documentElement.clientWidth;
      for (const element of doc.querySelectorAll('section,div,p,img,ul,ol,li,blockquote,h1,h2,h3,h4')) {
        const rect = element.getBoundingClientRect();
        if (rect.left < -1 || rect.right > viewportWidth + 1 || element.scrollWidth > element.clientWidth + 1) overflow(width, `${element.tagName.toLowerCase()}${element.dataset.nodeId ? ` 节点 ${element.dataset.nodeId}` : ''}，显示宽度 ${Math.round(rect.width)}px，内容宽度 ${element.scrollWidth}px`);
      }
      if (doc.documentElement.scrollWidth > viewportWidth + 1) overflow(width, `页面内容宽度 ${doc.documentElement.scrollWidth}px`);
    }
  } finally { frame.remove(); }
}
