import { LayoutDesignSchema, layoutContentStyle, layoutLeaves, layoutSource, reconcileLayout } from './layout-design.js';
import { articleField, BlockStyleSchema } from './core.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fonts = {
  sans: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
  serif: "'Songti SC',SimSun,Georgia,serif",
  mono: "Consolas,'PingFang SC','Microsoft YaHei',monospace",
};
const cssNames = { color: 'color', backgroundColor: 'background-color', fontSize: 'font-size', fontWeight: 'font-weight', lineHeight: 'line-height', letterSpacing: 'letter-spacing', textAlign: 'text-align', marginTop: 'margin-top', marginBottom: 'margin-bottom', borderRadius: 'border-radius' };
const pixels = new Set(['fontSize', 'letterSpacing', 'marginTop', 'marginBottom', 'borderRadius']);
function styleCss(style = {}) {
  let css = Object.entries(cssNames).filter(([key]) => style[key] !== undefined).map(([key, property]) => `${property}:${style[key]}${pixels.has(key) ? 'px' : ''};`).join('');
  if (style.fontFamily) css += `font-family:${fonts[style.fontFamily]};`;
  if (style.paddingX !== undefined) css += `padding-left:${style.paddingX}px;padding-right:${style.paddingX}px;`;
  if (style.paddingY !== undefined) css += `padding-top:${style.paddingY}px;padding-bottom:${style.paddingY}px;`;
  if (style.borderSide) css += `${style.borderSide === 'all' ? 'border' : `border-${style.borderSide}`}:${style.borderWidth || 1}px ${style.borderStyle || 'solid'} ${style.borderColor || style.color || '#64748B'};`;
  return css;
}
function emphasizedText(value, emphasis = []) {
  const text = String(value || '');
  const matches = [];
  for (const fragment of emphasis) {
    let from = 0, at;
    while ((at = text.indexOf(fragment, from)) >= 0) {
      matches.push([at, at + fragment.length]);
      from = at + fragment.length;
    }
  }
  matches.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let offset = 0, html = '';
  for (const [start, end] of matches) {
    if (start < offset) continue;
    html += escapeHtml(text.slice(offset, start)) + `<strong style="font-weight:700;">${escapeHtml(text.slice(start, end))}</strong>`;
    offset = end;
  }
  return html + escapeHtml(text.slice(offset));
}
export function renderLayoutArticle(article, assets, { mode, anchor, imageUrl, editing = false }) {
  const parsed = LayoutDesignSchema.safeParse(article.layoutDesign);
  if (!parsed.success) return null;
  const design = parsed.data;
  const source = new Map(layoutSource(article).map(item => [item.ref, item]));
  if (editing) for (const field of ['title', 'summary']) source.set(field, { ref: field, type: field, text: article[field] || '' });
  const blocks = new Map(article.blocks.map(block => [`block:${block.id}`, block]));
  for (const field of ['title', 'summary']) blocks.set(field, articleField(article, field));
  const colors = { primary: design.rules.heading?.color || design.page.color, accent: design.rules.heading?.borderColor || design.page.color, red: '#A6372C', orange: '#9E4D20', green: '#276143' };
  const styledText = (runs, emphasis) => {
    if (!runs.some(run => Object.keys(run).some(key => key !== 'text'))) return emphasizedText(runs.map(run => run.text).join(''), emphasis);
    return runs.map(run => {
      let css = run.bold !== undefined ? `font-weight:${run.bold ? 700 : 400};` : '';
      if (run.underline !== undefined) css += `text-decoration:${run.underline ? 'underline' : 'none'};`;
      if (run.color) css += `color:${/^#[0-9a-f]{6}$/i.test(run.color) ? run.color : colors[run.color] || design.page.color};`;
      if (/^#[0-9a-f]{6}$/i.test(run.highlight || '')) css += `background-color:${run.highlight};`;
      return `<span style="${css}">${emphasizedText(run.text, run.bold === false ? [] : emphasis)}</span>`;
    }).join('');
  };
  const render = nodes => nodes.map(node => {
    if (node.type === 'group') return `<section style="box-sizing:border-box;width:100%;max-width:100%;${styleCss(node.style)}">${render(node.children)}</section>`;
    const item = source.get(node.ref);
    const block = blocks.get(node.ref);
    const manual = BlockStyleSchema.safeParse(block?.style || {}).data || {};
    const style = { ...layoutContentStyle(design, item, node), ...(manual.fontSize ? { fontSize: manual.fontSize } : {}), ...(manual.lineHeight ? { lineHeight: manual.lineHeight } : {}), ...(manual.align ? { textAlign: manual.align } : {}), ...(manual.paragraphSpacing !== undefined ? { marginBottom: manual.paragraphSpacing } : {}) };
    const text = value => emphasizedText(value, node.emphasis);
    const part = (name = 'runs', index) => editing ? ` data-editor-part="${name}"${index !== undefined ? ` data-editor-index="${index}"` : ''}` : '';
    const paragraph = (value, extra = '', runs, name = 'runs') => `<p${part(name)} style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;word-break:break-word;${manual.indent !== undefined ? `text-indent:${manual.indent}em;` : ''}${extra}">${runs ? styledText(runs, node.emphasis) : text(value)}</p>`;
    let content;
    if (item.type === 'image') {
      const url = imageUrl(assets.get(item.assetId), mode);
      content = (item.title ? paragraph(item.title, 'font-weight:700;margin-bottom:10px;', null, 'title') : '')
        + (url ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(item.caption || item.title || '文章图片')}" style="display:block;width:100%;max-width:100%;height:auto;border-radius:${style.borderRadius || 0}px;" />` : `<p style="padding:24px 0;text-align:center;">${escapeHtml(`[图片待补充：${item.caption || item.title || '请重新上传图片'}]`)}</p>`)
        + (item.caption || editing ? paragraph(item.caption, 'font-size:13px;line-height:1.8;margin-top:10px;', null, 'caption') : '');
    } else if (item.type === 'list') {
      content = item.items.map((value, index) => `<p style="margin:${index ? `${manual.itemSpacing ?? 10}px` : '0'} 0 0;white-space:pre-wrap;"><span>${item.ordered ? `${index + 1}.` : '•'} </span><span${part('item', index)}>${styledText(block.items[index], node.emphasis)}</span></p>`).join('');
    } else if (item.type === 'quote') {
      content = paragraph(item.text, '', block.runs) + (item.cite || editing ? `<p style="font-size:13px;margin:10px 0 0;">— <span${part('cite')}>${escapeHtml(item.cite)}</span></p>` : '');
    } else if (item.type === 'divider') {
      content = '<p style="margin:0;border-top:1px solid;font-size:1px;line-height:1;">&nbsp;</p>';
    } else content = paragraph(item.text, '', block?.runs);
    const placement = item.type === 'image' ? `width:${manual.imageWidth || 100}%;margin-left:${['right', 'center'].includes(manual.align) ? 'auto' : '0'};margin-right:${manual.align === 'right' ? '0' : 'auto'};` : '';
    return anchor(`<section style="box-sizing:border-box;width:100%;max-width:100%;${styleCss(style)}${placement}">${content}</section>`, item.ref)
      + (editing && item.ref === 'title' && !article.summary ? render([{ type: 'content', ref: 'summary' }]) : '');
  }).join('');
  const page = design.page;
  const nodes = reconcileLayout(design, article);
  const refs = new Set(layoutLeaves(nodes).map(node => node.ref));
  const leading = editing ? ['title', 'summary'].filter(ref => !refs.has(ref)).map(ref => ({ type: 'content', ref })) : [];
  return `<section style="box-sizing:border-box;width:100%;max-width:100%;padding:24px ${page.paddingX}px;font-family:${fonts[page.fontFamily]};font-size:${page.fontSize}px;line-height:${page.lineHeight};color:${page.color};background-color:${page.backgroundColor};overflow-wrap:anywhere;word-break:break-word;">${render([...leading, ...nodes])}</section>`;
}
