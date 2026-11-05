import { articleField, BlockStyleSchema, blockText } from './core.js';
import { renderLayoutArticle } from './layout-renderer.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fonts = {
  sans: "-apple-system,BlinkMacSystemFont,'PingFang SC','Microsoft YaHei',sans-serif",
  serif: "'Songti SC',SimSun,'Noto Serif CJK SC',Georgia,serif",
  mono: "'SFMono-Regular',Consolas,'PingFang SC','Microsoft YaHei',monospace",
};
const number = n => String(n).padStart(2, '0');
const base = t => `font-family:${fonts[t.layout.bodyFont] || fonts.sans};color:${t.tokens.text};font-size:${t.tokens.bodySize}px;line-height:${t.tokens.lineHeight};letter-spacing:${t.tokens.letterSpacing}px;overflow-wrap:anywhere;word-break:break-word;box-sizing:border-box;`;
const headingFont = t => `font-family:${fonts[t.layout.headingFont] || fonts.sans};`;
const label = (text, t, css = '') => `<p style="${base(t)}font-size:11px;line-height:1.6;letter-spacing:2px;color:${t.tokens.accent};margin:0 0 12px;${css}">${escapeHtml(text)}</p>`;
const manualStyle = block => BlockStyleSchema.safeParse(block.style || {}).data || {};
const spacing = (block, fallback) => manualStyle(block).paragraphSpacing ?? fallback;
const editPart = (t, part = 'runs', index) => t.editing ? ` data-editor-part="${part}"${index !== undefined ? ` data-editor-index="${index}"` : ''}` : '';
const textStyle = block => {
  const style = manualStyle(block);
  return `${style.fontSize ? `font-size:${style.fontSize}px;` : ''}${style.align ? `text-align:${style.align};` : ''}${style.lineHeight ? `line-height:${style.lineHeight};` : ''}${style.indent !== undefined ? `text-indent:${style.indent}em;` : ''}`;
};

function textRuns(runs = [], t, inverse = false, decorate = true) {
  const { primary, accent, tint, onPrimary } = t.tokens;
  const colors = { primary, accent, red: '#A6372C', orange: '#9E4D20', green: '#276143' };
  return runs.map(run => {
    const customColor = /^#[0-9a-f]{6}$/i.test(run.color || '');
    let css = '';
    if (run.bold) {
      css += 'font-weight:700;';
      if (!inverse && decorate) css += {
        underline: `border-bottom:2px solid ${accent};padding-bottom:1px;`,
        fill: `background-color:${tint};color:${primary};padding:1px 3px;`,
        color: `color:${primary};`,
      }[t.layout.emphasisStyle] || '';
    }
    if (run.bold === false) css += 'font-weight:400;';
    if (run.color) css += `color:${customColor ? run.color : inverse ? onPrimary : colors[run.color] || primary};`;
    if (run.underline) css += 'text-decoration:underline;border-bottom:0;';
    if (run.underline === false) css += 'text-decoration:none;border-bottom:0;';
    if (/^#[0-9a-f]{6}$/i.test(run.highlight || '')) css += `background-color:${run.highlight};`;
    const tag = run.bold ? 'strong' : 'span';
    const format = t.editing ? ` data-run-format="${escapeHtml(JSON.stringify(run))}"` : '';
    return `<${tag}${format} style="${css}">${escapeHtml(run.text)}</${tag}>`;
  }).join('');
}

function renderHeader(article, t) {
  if (!article.title && !t.editing) return '';
  const { primary, accent, tint, onPrimary, border, highlight = onPrimary } = t.tokens;
  const size = article.title.length > 48 ? 23 : article.title.length > 32 ? 25 : t.tokens.titleSize || 28;
  const titleCss = `${base(t)}${headingFont(t)}font-size:${size}px;line-height:1.5;font-weight:800;letter-spacing:0.5px;margin:0;`;
  const field = articleField(article, 'title');
  const title = (extra = '') => `<p${editPart(t)} style="${titleCss}${extra}${textStyle(field)}${field.style?.paragraphSpacing !== undefined ? `margin-bottom:${field.style.paragraphSpacing}px;` : ''}">${textRuns(field.runs, t, false, false)}</p>`;
  const kicker = (extra = '') => label(t.layout.headerLabel, t, extra);
  const rule = (color = accent, width = '100%', extra = '') => `<p style="margin:16px 0 0;border-top:1px solid ${color};width:${width};font-size:1px;line-height:1;${extra}">&nbsp;</p>`;
  const panel = (content, css) => `<section style="${css}">${content}</section>`;
  const blocks = `<p style="font-size:1px;line-height:1;margin:0 0 16px;"><span style="display:inline-block;width:28px;height:6px;background-color:${primary};"></span><span style="display:inline-block;width:16px;height:6px;margin-left:4px;background-color:${accent};"></span><span style="display:inline-block;width:8px;height:6px;margin-left:4px;background-color:${primary};"></span></p>`;
  let content;
  switch (t.layout.headerStyle) {
    case 'essay':
      content = `${kicker(`border-bottom:3px solid ${primary};padding-bottom:10px;`)}${title()}${rule(accent, '38px')}`; break;
    case 'magazine':
      content = `${kicker('text-align:center;border-bottom:1px solid '+accent+';padding-bottom:10px;')}${panel(title(`color:${onPrimary};text-align:center;`)+rule(onPrimary, '38px', 'margin:18px auto 0;'), `background-color:${primary};padding:28px 16px;border:5px double ${onPrimary};`)}`; break;
    case 'book':
      content = panel(`${kicker()}${title()}${label('—　读 · 记　—', t, 'margin:14px 0 0;')}`, `border-top:4px double ${primary};border-bottom:4px double ${primary};padding:20px 4px;text-align:center;`); break;
    case 'manifesto':
      content = `${kicker(`border-left:8px solid ${accent};padding-left:10px;font-weight:700;`)}${panel(title(`color:${onPrimary};`), `background-color:${primary};padding:22px 16px;`)}${rule(accent, '100%', 'border-top-width:6px;margin-top:5px;')}`; break;
    case 'checklist':
      content = `${kicker()}${panel(label('✓', t, `font-size:32px;line-height:1;color:${primary};margin-bottom:12px;`)+title(), `border:1px solid ${primary};border-top:5px solid ${primary};border-radius:4px;padding:22px 16px;`)}${rule(accent, '52px')}`; break;
    case 'circuit':
      content = panel(`${blocks}${kicker()}${title()}${label('● ───────── ●', t, `color:${primary};margin:18px 0 0;letter-spacing:0;`)}`, `border-left:3px solid ${primary};padding:12px 0 2px 14px;`); break;
    case 'observatory':
      content = panel(`${kicker(`color:${onPrimary};`)}${rule(onPrimary, '24px', 'margin:0 0 22px;')}${title(`color:${onPrimary};`)}${label('＋　＋　＋', t, `color:${onPrimary};margin:20px 0 0;text-align:right;`)}`, `background-color:${primary};border-bottom:6px solid ${accent};padding:24px 18px;`); break;
    case 'archive':
      content = panel(`${kicker(`background-color:${primary};color:${onPrimary};padding:8px 12px;margin:0;`)}${panel(title()+label('＋　＋　＋', t, 'margin:16px 0 0;'), 'padding:20px 14px;')}`, `border:1px dashed ${primary};`); break;
    case 'radar':
      content = `${label('◎', t, `font-family:${fonts.mono};font-size:40px;line-height:1;color:${primary};margin-bottom:14px;`)}${kicker(`border-bottom:1px dashed ${primary};padding-bottom:10px;`)}${title()}${rule(primary, '100%', 'border-top-width:3px;')}`; break;
    case 'product':
      content = `${kicker(`display:inline-block;background-color:${primary};color:${onPrimary};padding:6px 12px;border-radius:6px 6px 0 0;margin:0;`)}${panel(title()+rule(), `border:1px solid ${border};border-top:3px solid ${primary};background-color:#FFFFFF;padding:22px 16px;`)}`; break;
    case 'business':
      content = `${kicker(`border-top:5px solid ${primary};border-bottom:1px solid ${accent};padding:12px 0;`)}${title()}${panel(label('◆', t, 'margin:0;'), `margin-top:18px;border-bottom:1px solid ${primary};padding-bottom:8px;text-align:right;`)}`; break;
    case 'monthly':
      content = panel(`${kicker(`background-color:${primary};color:${onPrimary};padding:10px 14px;margin:0;`)}${panel(title()+rule(accent, '44px'), 'padding:22px 14px;')}`, `border:1px solid ${primary};border-bottom:4px solid ${primary};`); break;
    case 'insight':
      content = panel(`${kicker(`display:inline-block;border-bottom:2px solid ${accent};padding-bottom:8px;`)}${title()}${rule(accent, '32px')}`, `border:4px double ${accent};background-color:${tint};padding:24px 16px;`); break;
    case 'bulletin':
      content = `${kicker(`text-align:center;border-top:3px solid ${primary};border-bottom:1px solid ${primary};padding:12px 0;`)}${title(`text-align:center;padding:12px 4px;`)}${rule(primary)}`; break;
    case 'strategy':
      content = `${kicker(`display:inline-block;border:1px solid ${accent};padding:5px 10px;background-color:${tint};`)}${title()}${rule(primary, '100%', 'border-top-style:dashed;')}${label('NOTES /', t, 'text-align:right;margin:10px 0 0;')}`; break;
    case 'campus':
      content = panel(`${label('✦', t, `font-size:28px;line-height:1;color:${accent};`)}${kicker()}${title(`text-align:center;`)}`, `text-align:center;border:2px solid ${primary};border-bottom:6px solid ${accent};border-radius:12px 12px 2px 2px;background-color:${tint};padding:22px 14px;`); break;
    case 'puzzle':
      content = `${blocks}${kicker(`display:inline-block;background-color:${primary};color:${onPrimary};padding:5px 10px;`)}${panel(title(), `background-color:${tint};border-left:6px solid ${accent};padding:20px 14px;`)}`; break;
    case 'lecture':
      content = `${kicker(`border-bottom:1px solid ${primary};padding-bottom:10px;text-align:right;`)}${title(`padding:12px 0;`)}${rule(primary, '100%', 'border-top:4px double '+primary+';margin-top:0;')}`; break;
    case 'qa':
      content = `${label('Q / A', t, `font-family:${fonts.mono};font-size:34px;font-weight:800;line-height:1.2;color:${primary};letter-spacing:-1px;`)}${kicker()}${title()}${rule(accent, '100%', 'border-top-width:4px;')}`; break;
    case 'growth':
      content = panel(`${label('•　•　•　•　•', t, 'text-align:center;margin-bottom:18px;')}${kicker()}${title()}${rule(accent, '32px')}`, `background-color:${tint};border-top:3px solid ${accent};border-bottom:1px dashed ${accent};border-radius:10px 10px 0 0;padding:12px 16px 22px;`); break;
    case 'daily':
      content = panel(`${kicker()}${label('✳', t, 'font-size:24px;margin-bottom:12px;')}${title()}${rule(accent, '32px', 'margin:18px auto 0;')}`, `background-color:${tint};border-radius:24px 24px 4px 4px;text-align:center;padding:24px 16px;`); break;
    case 'city':
      content = `${kicker(`color:${onPrimary};background-color:${accent};display:inline-block;padding:5px 10px;`)}${title(`border-top:4px solid ${primary};border-bottom:1px solid ${primary};padding:16px 0;`)}${label('◇　◇　◇', t, 'margin:12px 0 0;text-align:right;')}`; break;
    case 'forest':
      content = panel(`${label('记', t, `display:inline-block;background-color:${primary};color:${onPrimary};font-size:20px;padding:4px 10px;`)}${kicker()}${title()}${rule(accent, '44px')}`, `border-left:2px dashed ${accent};padding:8px 0 8px 16px;`); break;
    case 'oxygen':
      content = panel(`${label('○　○　○', t, `font-size:22px;line-height:1.2;color:${primary};`)}${kicker(`display:inline-block;border:1px solid ${primary};border-radius:99px;padding:4px 12px;`)}${title(`text-align:center;`)}`, `text-align:center;background-color:${tint};border-radius:30px 30px 12px 12px;padding:24px 14px;`); break;
    case 'letter':
      content = `${label('◯', t, `font-size:32px;line-height:1;text-align:center;color:${accent};`)}${kicker('text-align:center;')}${title(`text-align:center;padding:12px 4px;`)}${rule(accent, '100%', 'border-top-style:dashed;')}`; break;
    case 'city-ticket':
      content = panel(`${kicker(`border-bottom:1px dashed ${primary};padding-bottom:12px;`)}${title()}${label('• • • • • • • • • • • •', t, 'margin:18px 0 0;letter-spacing:2px;')}`, `border:2px solid ${primary};border-left:5px dashed ${primary};border-right:5px dashed ${primary};background-color:${tint};padding:20px 14px;`); break;
    case 'garden':
      content = panel(`${label('✳　◇　✳', t, 'text-align:center;font-size:18px;')}${kicker('text-align:center;')}${title('text-align:center;')}${rule(accent, '44px', 'margin:18px auto 0;')}`, `border:1px solid ${accent};border-top:4px double ${primary};border-bottom:4px double ${primary};padding:24px 14px;`); break;
    case 'course':
      content = `${kicker(`display:inline-block;padding:6px 12px;background-color:${primary};color:${onPrimary};margin:0;`)}${panel(title()+rule(accent, '48px'), `border:1px solid ${primary};border-bottom:6px solid ${accent};padding:22px 16px;background-color:${tint};`)}`; break;
    case 'oriental':
      content = panel(`${label('雅', t, `display:inline-block;font-family:${fonts.serif};font-size:23px;line-height:1.4;color:${onPrimary};background-color:${primary};border:3px double ${onPrimary};padding:4px 8px;`)}${kicker()}${title(`color:${primary};text-align:center;`)}${label('◇　◆　◇', t, 'margin:18px 0 0;')}`, `border-top:4px double ${primary};border-bottom:1px solid ${accent};text-align:center;padding:24px 6px;`); break;
    case 'party':
      content = `${blocks}${panel(kicker(`color:${onPrimary};margin:0;`), `background-color:${primary};border-radius:14px 14px 0 0;padding:10px 14px;`)}${panel(title()+label('✦　✦　✦', t, 'text-align:right;margin:18px 0 0;'), `background-color:${tint};border:2px solid ${primary};border-top:0;border-bottom:4px dashed ${accent};padding:22px 14px;`)}`; break;
    case 'newsflash':
      content = `${kicker(`color:${onPrimary};background-color:${primary};display:inline-block;padding:5px 10px;font-weight:700;`)}${title('font-weight:900;')}${rule(primary, '100%', 'border-top-width:4px;')}`; break;
    case 'feature':
      content = `${kicker(`border-top:1px solid ${primary};border-bottom:1px solid ${primary};padding:10px 0;`)}${title('padding:10px 0;')}${rule(accent, '30px')}${label('—', t, 'text-align:right;margin:8px 0 0;')}`; break;
    case 'quick':
      content = `${kicker(`border-left:12px solid ${primary};padding-left:10px;`)}${panel(title(`color:${onPrimary};`), `background-color:${primary};padding:22px 16px;`)}${rule(accent, '66%', 'border-top-width:6px;margin-top:5px;')}`; break;
    case 'interview':
      content = `${label('“', t, `font-family:${fonts.serif};font-size:64px;line-height:0.9;color:${accent};text-align:center;margin-bottom:4px;`)}${kicker('text-align:center;')}${title('text-align:center;')}${rule(accent, '48px', 'margin:20px auto 0;')}`; break;
    case 'weekly':
      content = `${kicker(`background-color:${primary};color:${onPrimary};padding:10px 12px;`)}${title('padding:6px 0 12px;')}${rule(primary, '100%', 'border-top:3px double '+primary+';margin-top:0;')}`; break;
    case 'brand-blue':
      content = panel(`${kicker(`color:${onPrimary};border-bottom:1px solid ${onPrimary};padding-bottom:12px;`)}${title(`color:${onPrimary};padding-top:8px;`)}${rule(onPrimary, '42px')}`, `background-color:${primary};padding:26px 18px;border-bottom:6px solid ${accent};`); break;
    case 'black-gold':
      content = panel(`${kicker(`color:${highlight};`)}${title(`color:${onPrimary};text-align:center;`)}${label('◆', t, `color:${highlight};margin:20px 0 0;`)}`, `background-color:${primary};border:5px double ${highlight};padding:28px 14px;text-align:center;`); break;
    case 'mint':
      content = `${kicker(`display:inline-block;background-color:${primary};color:${onPrimary};border-radius:99px;padding:5px 12px;`)}${panel(title()+rule(accent, '36px'), `background-color:${tint};border:1px solid ${primary};border-bottom:3px dotted ${primary};border-radius:4px 22px 4px 22px;padding:24px 16px;`)}`; break;
    case 'visual':
      content = `${kicker(`text-align:right;border-top:1px solid ${primary};padding-top:12px;`)}${title('padding:18px 0 22px;')}${rule(primary, '100%', 'border-top-width:5px;margin-top:0;')}${label('◇', t, 'margin:10px 0 0;text-align:right;')}`; break;
    case 'service':
      content = `${label('□ ── □ ── □', t, `font-family:${fonts.mono};font-size:18px;color:${primary};letter-spacing:0;`)}${kicker()}${title()}${rule(primary, '100%', 'border-top-width:3px;')}`; break;
    default: content = `${kicker()}${title()}${rule()}`;
  }
  return `<section style="margin:0 0 26px;">${content}</section>`;
}

function renderSummary(article, t) {
  const summary = article.summary;
  if (!summary?.trim() && !t.editing) return '';
  const { primary, accent, tint, onPrimary, border } = t.tokens;
  const style = t.layout.summaryStyle;
  const styles = {
    rule: `border-left:3px solid ${accent};padding:2px 0 2px 14px;`,
    inset: `background-color:${tint};border:1px solid ${border};padding:16px;border-radius:${t.tokens.radius}px;`,
    dark: `background-color:${primary};color:${onPrimary};padding:18px 16px;border-radius:${t.tokens.radius}px;`,
    center: `text-align:center;padding:10px 12px 18px;border-bottom:1px solid ${border};`,
    note: `background-color:${tint};border-top:2px solid ${accent};border-bottom:1px dashed ${border};padding:16px;`,
  };
  const field = articleField(article, 'summary');
  return `<section style="${base(t)}margin:0 0 ${spacing(field, 28)}px;${styles[style] || styles.rule}">${label('导读', t, `margin:0 0 7px;${style === 'dark' ? `color:${onPrimary};` : ''}`)}<p${editPart(t)} style="font-size:15px;line-height:1.9;margin:0;white-space:pre-wrap;${textStyle(field)}">${textRuns(field.runs, t, style === 'dark', false)}</p></section>`;
}

const hasChapterNumber = text => /^(?:第[一二三四五六七八九十百零〇\d]+[章节篇部]|[一二三四五六七八九十]+[、．.]|\d{1,2}[、．](?!\d)|\d{1,2}\.(?:\s|(?=[^\d]))|[（(][一二三四五六七八九十\d]{1,3}[)）])/.test(text.trim());

function renderHeading(block, index, t, primaryLevel) {
  const { primary, accent, tint, onPrimary } = t.tokens;
  const text = block.runs ? textRuns(block.runs, t) : escapeHtml(block.text);
  if (block.level !== primaryLevel) return `<p${editPart(t)} style="${base(t)}${headingFont(t)}font-size:18px;font-weight:700;color:${primary};margin:22px 0 ${spacing(block, 14)}px;padding-left:10px;border-left:2px solid ${accent};${textStyle(block)}">${text}</p>`;
  const n = number(index);
  const markers = {
    hairline: label(`${n} /`, t, `border-top:1px solid ${accent};padding-top:14px;margin-bottom:8px;`),
    'num-prefix': label(`${n} /`, t, 'font-size:15px;margin-bottom:6px;'),
    'num-square': label(n, t, `display:inline-block;background-color:${primary};color:${onPrimary};padding:5px 10px;margin-bottom:10px;`),
    'side-line': label(n, t, `border-left:4px solid ${accent};padding-left:10px;margin-bottom:8px;`),
    tag: label(`章节 ${n}`, t, `display:inline-block;background-color:${tint};border:1px solid ${accent};padding:3px 8px;margin-bottom:10px;`),
    'short-line': label(n, t, `border-top:3px solid ${accent};padding-top:9px;width:38px;margin-bottom:8px;`),
    'big-num': label(n, t, 'font-size:38px;line-height:1.1;letter-spacing:-1px;font-weight:800;margin-bottom:8px;'),
    question: label(`Q / ${n}`, t, 'font-size:14px;font-weight:700;margin-bottom:8px;'),
    step: label(`STEP ${n}`, t, `display:inline-block;border-bottom:2px solid ${accent};padding-bottom:4px;margin-bottom:10px;`),
    'index-row': label(`${n}　/　CONTENTS`, t, `border-bottom:1px solid ${accent};padding-bottom:8px;margin-bottom:12px;`),
    dot: label(`●　${n}`, t, 'margin-bottom:8px;'),
    none: '',
  };
  const marker = hasChapterNumber(block.text) ? '' : markers[t.layout.sectionMark] || '';
  return `<section style="margin:${index > 1 ? t.tokens.sectionGap : 0}px 0 ${spacing(block, 20)}px;">${marker}<p${editPart(t)} style="${base(t)}${headingFont(t)}font-size:22px;line-height:1.55;font-weight:800;color:${primary};margin:0;${textStyle(block)}">${text}</p></section>`;
}

const imageUrl = (asset, mode) => {
  if (mode !== 'preview' && asset?.pasteStatus === 'broken') return '';
  const candidates = mode === 'preview' ? [asset?.previewUrl, asset?.url] : [asset?.url];
  return candidates.find(url => typeof url === 'string' && (/^https:\/\//i.test(url) || (mode === 'preview' && /^(blob:|data:image\/(?:png|jpeg|webp);base64,|\/uploads\/)/i.test(url)))) || '';
};

function renderImage(block, t, assets, mode) {
  const { primary, accent, tint, border, radius, textMuted, onPrimary } = t.tokens;
  const style = t.layout.cardStyle;
  const url = imageUrl(assets.get(block.assetId), mode);
  const corner = style === 'rounded' ? Math.max(radius, 12) : style === 'polaroid' || style === 'film' || style === 'folio' ? 0 : radius;
  const image = url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(block.caption || block.title || '文章图片')}" style="display:block;width:100%;max-width:100%;height:auto;border-radius:${corner}px;" />`
    : `<p style="margin:0;padding:30px 10px;background-color:${tint};text-align:center;color:${textMuted};font-size:13px;line-height:1.7;">[图片待补充：${escapeHtml(block.caption || block.title || '请重新上传图片')}]</p>`;
  const hasTitle = Boolean(block.title?.trim());
  const hasCaption = Boolean(block.caption?.trim()) || t.editing;
  const hasDescription = hasTitle || hasCaption;
  const title = (css = '') => hasTitle ? `<p${editPart(t, 'title')} style="font-weight:700;line-height:1.7;color:${primary};margin:0 0 10px;${css}">${escapeHtml(block.title)}</p>` : '';
  const caption = (css = '') => hasCaption ? `<p${editPart(t, 'caption')} style="font-size:13px;line-height:1.8;color:${textMuted};margin:10px 0 0;white-space:pre-wrap;${css}">${escapeHtml(block.caption)}</p>` : '';
  let content;
  let css = '';
  switch (style) {
    case 'bordered':
      css = `border:1px solid ${border};padding:8px;`;
      content = `${title()}${image}${caption('text-align:center;')}`; break;
    case 'rounded':
      css = `background-color:#FFFFFF;border:1px solid ${border};border-radius:${Math.max(radius, 14)}px;padding:10px;`;
      content = `${image}${hasDescription ? `<section style="padding:12px 4px 2px;">${title()}${caption('margin-top:0;')}</section>` : ''}`; break;
    case 'story':
      content = `${image}${hasDescription ? `<section style="background-color:${tint};border-left:3px solid ${accent};padding:16px 14px;">${title()}${caption('margin-top:0;')}</section>` : ''}`; break;
    case 'info':
      css = `border:1px solid ${border};`;
      content = `${hasTitle ? `<section style="padding:10px 12px;background-color:${primary};">${title(`color:${onPrimary};margin:0;`)}</section>` : ''}${image}${hasCaption ? `<section style="padding:12px;background-color:${tint};">${caption('margin:0;')}</section>` : ''}`; break;
    case 'image-first':
      content = `${image}${hasDescription ? `<section style="margin-top:14px;border-left:2px solid ${accent};padding-left:12px;">${title()}${caption('margin-top:0;')}</section>` : ''}`; break;
    case 'compact':
      content = `${title('font-size:14px;')}${image}${caption(`text-align:right;border-bottom:1px solid ${border};padding-bottom:10px;`)}`; break;
    case 'flow':
      css = `border-left:2px solid ${border};padding-left:12px;`;
      content = `${title()}${image}${caption()}`; break;
    case 'polaroid':
      css = `padding:8px 8px 18px;background-color:#FFFFFF;border:1px solid ${border};`;
      content = `${image}${hasDescription ? `<section style="padding:14px 6px 0;text-align:center;">${title(`${headingFont(t)}font-size:16px;`)}${caption('margin-top:0;')}</section>` : ''}`; break;
    case 'film':
      content = `<section style="background-color:${primary};padding:8px;">${label('•　•　•　•　•　•', t, `color:${onPrimary};text-align:center;font-size:8px;margin-bottom:8px;`)}${image}${label('•　•　•　•　•　•', t, `color:${onPrimary};text-align:center;font-size:8px;margin:8px 0 0;`)}</section>${hasDescription ? `<section style="padding-top:14px;">${title()}${caption('margin-top:0;')}</section>` : ''}`; break;
    case 'folio':
      css = `border-top:1px solid ${accent};padding-top:10px;`;
      content = `${image}${hasDescription ? `<section style="padding:14px 0;border-bottom:1px solid ${border};">${title(`${headingFont(t)}`)}${caption('margin-top:0;')}</section>` : ''}`; break;
    default:
      content = `${title()}${image}${caption('text-align:center;')}`;
  }
  const size = manualStyle(block);
  const placement = size.imageWidth !== undefined || size.align ? `width:${size.imageWidth ?? 100}%;max-width:100%;margin-left:${size.align === 'right' || size.align === 'center' ? 'auto' : '0'};margin-right:${size.align === 'right' ? '0' : 'auto'};` : '';
  return `<section style="${base(t)}margin:24px 0 ${spacing(block, 24)}px;${css}${placement}">${content}</section>`;
}

function renderQuote(block, t) {
  const { accent, primary, tint, border } = t.tokens;
  const style = t.layout.quoteStyle;
  const styles = {
    pull: `text-align:center;padding:22px 14px;border-top:1px solid ${accent};border-bottom:1px solid ${accent};`,
    frame: `border:1px solid ${accent};padding:18px;border-radius:${t.tokens.radius}px;`,
    soft: `background-color:${tint};border-radius:16px;padding:20px 18px;`,
    editorial: `border-left:4px solid ${accent};padding:4px 0 4px 16px;`,
  };
  const opening = style === 'pull' ? `<p style="${headingFont(t)}font-size:42px;line-height:1;color:${accent};margin:0 0 4px;">“</p>` : '';
  const cite = block.cite || t.editing ? `<p style="font-size:13px;color:${t.tokens.textMuted};text-align:right;margin:12px 0 0;border-top:1px solid ${border};padding-top:10px;">— <span${editPart(t, 'cite')}>${escapeHtml(block.cite)}</span></p>` : '';
  return `<section style="${base(t)}margin:22px 0 ${spacing(block, 22)}px;${styles[style] || styles.editorial}">${opening}<p${editPart(t)} style="${headingFont(t)}font-size:${style === 'pull' ? 19 : 16}px;line-height:1.9;color:${primary};margin:0;white-space:pre-wrap;${textStyle(block)}">${textRuns(block.runs, t)}</p>${cite}</section>`;
}

function renderList(block, t) {
  const { primary, accent, tint, border } = t.tokens;
  const style = t.layout.listStyle;
  const itemSpacing = manualStyle(block).itemSpacing;
  const items = block.items.map((runs, index) => {
    const marker = block.ordered ? number(index + 1) : style === 'checklist' ? '□' : '•';
    const badge = style === 'steps' || style === 'tiles';
    const markerCss = badge ? `background-color:${primary};color:${t.tokens.onPrimary};border-radius:${style === 'steps' ? '99' : '3'}px;padding:2px 7px;` : `color:${accent};font-weight:700;`;
    const itemCss = style === 'tiles' ? `padding:14px;background-color:${tint};border-radius:${t.tokens.radius}px;` : style === 'ruled' ? `padding:12px 0;border-bottom:1px solid ${border};` : style === 'steps' ? `padding:12px;border-left:2px solid ${border};` : 'padding:7px 0;';
    const gapCss = itemSpacing !== undefined ? `margin:0 0 ${index < block.items.length - 1 ? itemSpacing : 0}px;padding-top:0;padding-bottom:0;` : '';
    return `<p style="margin:0 0 8px;${itemCss}${gapCss}white-space:pre-wrap;"><span style="display:inline-block;font-size:13px;line-height:1.8;margin-right:9px;vertical-align:baseline;${markerCss}">${escapeHtml(marker)}</span><span${editPart(t, 'item', index)}>${textRuns(runs, t)}</span></p>`;
  }).join('');
  return `<section style="${base(t)}margin:18px 0 ${spacing(block, 22)}px;${textStyle(block)}">${items}</section>`;
}

function renderDivider(t) {
  const { primary, accent } = t.tokens;
  const style = t.layout.dividerStyle;
  if (style === 'dots' || style === 'diamonds') return label(style === 'dots' ? '•　•　•' : '◇　◆　◇', t, 'text-align:center;margin:26px 0;');
  return `<p style="border-top:${style === 'double' ? '3px double' : '1px solid'} ${style === 'double' ? primary : accent};margin:28px 0;font-size:1px;line-height:1;">&nbsp;</p>`;
}

function renderParagraph(block, t, first) {
  const style = t.layout.openingStyle;
  let css = style === 'indent' ? 'text-indent:2em;' : '';
  let content = textRuns(block.runs, t);
  if (first) {
    if (style === 'lead') css += `font-size:17px;line-height:2;color:${t.tokens.primary};`;
    if (style === 'note') css += `padding:14px 12px;background-color:${t.tokens.tint};border-left:3px solid ${t.tokens.accent};`;
    if (style === 'rule') css += `border-bottom:1px solid ${t.tokens.border};padding-bottom:16px;`;
    if (style === 'dropcap' && block.runs[0]?.text && /^\S/.test(block.runs[0].text)) {
      const character = Array.from(block.runs[0].text)[0];
      const head = { ...block.runs[0], text: character };
      const tail = [{ ...block.runs[0], text: block.runs[0].text.slice(character.length) }, ...block.runs.slice(1)].filter(run => run.text);
      content = `<span${t.editing ? ' data-run-format="{}"' : ''} style="${headingFont(t)}font-size:32px;line-height:1;vertical-align:baseline;color:${t.tokens.primary};margin-right:3px;">${textRuns([head], t)}</span>${textRuns(tail, t)}`;
    }
  }
  return `<p${editPart(t)} style="${base(t)}margin:0 0 ${spacing(block, t.tokens.paraGap)}px;white-space:pre-wrap;${css}${textStyle(block)}">${content}</p>`;
}

function renderBlock(block, t, assets, mode, primaryLevel, context) {
  if (block.type === 'heading') return renderHeading(block, context.headingIndex, t, primaryLevel);
  if (block.type === 'paragraph') return renderParagraph(block, t, context.paragraphIndex++ === 0);
  if (block.type === 'quote') return renderQuote(block, t);
  if (block.type === 'list') return renderList(block, t);
  if (block.type === 'divider') return renderDivider(t);
  if (block.type === 'image' || block.type === 'imageCard') return renderImage(block, t, assets, mode);
  if (block.type === 'callout') {
    const { primary, accent, tint, border, onPrimary, radius } = t.tokens;
    const style = t.layout.calloutStyle;
    const inverse = style === 'solid-fill';
    const styles = {
      'soft-fill': `background-color:${tint};border-top:2px solid ${accent};`,
      'rounded-fill': `background-color:${tint};border-radius:${Math.max(radius, 12)}px;`,
      'solid-fill': `background-color:${primary};color:${onPrimary};border-radius:${radius}px;`,
      'side-bar': `background-color:${tint};border-left:4px solid ${accent};`,
      'thin-frame': `border:1px solid ${border};border-top:3px solid ${primary};`,
      'double-frame': `border:4px double ${accent};`,
      'dashed-frame': `border:1px dashed ${accent};background-color:${tint};`,
      'gold-frame': `border:1px solid ${accent};background-color:${tint};`,
    };
    return `<section style="${base(t)}margin:22px 0 ${spacing(block, 22)}px;padding:18px 16px;${styles[style] || styles['soft-fill']}">${label('重点', t, `margin-bottom:8px;${inverse ? `color:${onPrimary};` : ''}`)}<p${editPart(t)} style="margin:0;white-space:pre-wrap;${textStyle(block)}">${textRuns(block.runs, t, inverse)}</p></section>`;
  }
  return '';
}

function renderContents(headings, t) {
  if (!t.layout.showContents || headings.length < 3) return '';
  return `<section style="${base(t)}border-top:1px solid ${t.tokens.accent};border-bottom:1px solid ${t.tokens.border};padding:16px 0;margin:0 0 28px;">${label('内容索引', t)}${headings.map((block, index) => `<p style="font-size:13px;line-height:1.8;margin:6px 0;">${hasChapterNumber(block.text) ? '' : `<span style="color:${t.tokens.accent};margin-right:10px;">${number(index + 1)}</span>`}${escapeHtml(block.text)}</p>`).join('')}</section>`;
}

function pageCss(t) {
  const { primary, border } = t.tokens;
  return {
    edge: `border-top:3px solid ${primary};`,
    sheet: `border-left:1px solid ${border};border-right:1px solid ${border};`,
    paper: `border:1px solid ${border};border-top:3px double ${primary};`,
    folio: `border-top:1px solid ${primary};border-bottom:3px double ${primary};`,
    rail: `border-left:4px solid ${primary};`,
    none: '',
  }[t.layout.pageStyle] || '';
}

function renderEnding(t) {
  const { primary, accent, tint, border } = t.tokens;
  const end = (css = '') => label('END', t, `font-size:10px;letter-spacing:3px;margin:0;${css}`);
  const line = (css = '') => `<p style="border-top:1px solid ${accent};font-size:1px;line-height:1;margin:0 0 10px;${css}">&nbsp;</p>`;
  let content;
  switch (t.layout.footerStyle) {
    case 'ornament': content = `${label('◇　◆　◇', t, 'text-align:center;margin:0 0 8px;')}${end('text-align:center;')}`; break;
    case 'colophon': content = `${line(`border-top:3px double ${primary};`)}${end('text-align:right;')}`; break;
    case 'blocks': content = `<p style="font-size:1px;line-height:1;margin:0 0 10px;"><span style="display:inline-block;width:30px;height:5px;background-color:${primary};"></span><span style="display:inline-block;width:14px;height:5px;margin-left:4px;background-color:${accent};"></span></p>${end()}`; break;
    case 'check': content = `${line(`border-top-style:dashed;`)}${end(`background-color:${tint};padding:8px 12px;border-left:3px solid ${accent};`)}`; break;
    case 'signal': content = `${label('＋　＋　＋', t, 'margin:0 0 10px;text-align:right;')}${line()}${end()}`; break;
    case 'bands': content = `${line(`border-top:5px solid ${primary};margin-bottom:4px;`)}${line(`width:36%;border-top:2px solid ${accent};`)}${end('text-align:right;')}`; break;
    case 'file': content = `<section style="border:1px solid ${border};border-left:4px solid ${primary};padding:9px 12px;">${end('text-align:right;')}</section>`; break;
    case 'tab': content = `${line(`border-top-style:dashed;`)}${end(`display:inline-block;padding:5px 12px;background-color:${tint};border:1px solid ${border};`)}`; break;
    case 'leaf': content = `${label('○　◇　○', t, 'text-align:center;margin:0 0 8px;')}${end('text-align:center;')}`; break;
    case 'letter': content = `${line(`border-top-style:dashed;`)}${end('text-align:center;')}${label('—　◇　—', t, 'text-align:center;margin:10px 0 0;')}`; break;
    case 'ticket': content = `<section style="border-top:2px dashed ${accent};border-bottom:1px solid ${border};padding:10px 0;">${end('text-align:center;')}</section>`; break;
    case 'seal': content = `${line()}<section style="text-align:center;">${end(`display:inline-block;border:3px double ${accent};padding:7px 10px;`)}</section>`; break;
    case 'quote': content = `${label('”', t, `font-family:${fonts.serif};font-size:36px;line-height:1;margin:0 0 6px;text-align:center;`)}${end('text-align:center;')}`; break;
    default: content = `${line(`border-top:2px solid ${primary};`)}${end()}`;
  }
  return `<section style="margin:28px 0 4px;">${content}</section>`;
}

const allowedTags = new Set(['section', 'p', 'span', 'strong', 'br', 'img']);
const allowedAttrs = new Set(['style', 'src', 'alt']);
const allowedCss = new Set(['color', 'background-color', 'font-size', 'font-weight', 'font-family', 'line-height', 'letter-spacing', 'text-align', 'text-indent', 'text-decoration', 'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left', 'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left', 'border', 'border-left', 'border-right', 'border-top', 'border-top-style', 'border-top-width', 'border-bottom', 'border-style', 'border-color', 'border-width', 'border-radius', 'width', 'max-width', 'height', 'display', 'box-sizing', 'vertical-align', 'word-break', 'white-space', 'overflow-wrap']);
export function assertSafeHtml(html, { interactive = false, editing = false } = {}) {
  for (const match of html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)) {
    if (!allowedTags.has(match[1].toLowerCase())) throw new Error(`HTML tag is not allowed: ${match[1]}`);
    for (const attr of match[2].matchAll(/([a-z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi)) {
      const name = attr[1].toLowerCase();
      if (!allowedAttrs.has(name) && !(interactive && name === 'data-preview-key') && !(editing && ['data-editor-part', 'data-editor-index', 'data-run-format'].includes(name))) throw new Error(`HTML attribute is not allowed: ${attr[1]}`);
    }
    const style = match[2].match(/style="([^"]*)"/i)?.[1];
    if (style) for (const declaration of style.split(';').filter(Boolean)) {
      const colon = declaration.indexOf(':');
      const name = declaration.slice(0, colon).trim().toLowerCase();
      const value = declaration.slice(colon + 1);
      if (!allowedCss.has(name) || /url\s*\(|expression\s*\(|javascript:/i.test(value)) throw new Error(`CSS declaration is not allowed: ${declaration}`);
    }
    const src = match[2].match(/src="([^"]*)"/i)?.[1];
    if (src && !/^(https:\/\/|blob:|data:image\/(?:png|jpeg|webp);base64,|\/uploads\/)/i.test(src)) throw new Error('Image URL is not allowed');
  }
  return html;
}

export function renderArticle(article, template, assets = new Map(), opts = {}) {
  const mode = opts.mode || 'wechat';
  const editing = mode === 'preview' && opts.editing === true;
  if (editing) template = { ...template, editing: true };
  const interactive = mode === 'preview' && (opts.interactive === true || editing);
  const anchor = (html, key) => interactive && html ? html.replace(/^<([a-z]+)(?=[\s>])/i, `<$1 data-preview-key="${escapeHtml(key)}"`) : html;
  const primaryLevel = article.blocks.some(block => block.type === 'heading' && block.level === 1) ? 1 : 2;
  const headings = article.blocks.filter(block => block.type === 'heading' && block.level === primaryLevel);
  const context = { headingIndex: 0, paragraphIndex: 0 };
  const inner = article.blocks.map(block => {
    if (block.type === 'heading' && block.level === primaryLevel) context.headingIndex++;
    return anchor(renderBlock(block, template, assets, mode, primaryLevel, context), `block:${block.id}`);
  }).join('');
  const customHtml = article.layoutDesign ? renderLayoutArticle(article, assets, { mode, anchor, imageUrl, editing }) : null;
  const html = assertSafeHtml(customHtml ?? `<section style="${base(template)}max-width:100%;padding:24px ${template.tokens.pagePadding || 14}px;background-color:${template.tokens.page || '#FFFFFF'};${pageCss(template)}">${anchor(renderHeader(article, template), 'title')}${anchor(renderSummary(article, template), 'summary')}${renderContents(headings, template)}${inner}${renderEnding(template)}</section>`, { interactive, editing });
  const plainBlocks = article.blocks.map(block => block.type === 'image' || block.type === 'imageCard' ? `[图片：${block.caption || block.title || '文章图片'}]` : block.type === 'quote' && block.cite ? `${blockText(block)}\n— ${block.cite}` : blockText(block));
  const text = [article.title, article.summary, ...plainBlocks].filter(Boolean).join('\n\n');
  const images = article.blocks.filter(block => block.type === 'image' || block.type === 'imageCard').map(block => ({ assetId: block.assetId, caption: block.caption || block.title || '' }));
  return { html, text, images };
}
