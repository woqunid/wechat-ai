import { blockText } from './core.js';

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const colorToken = { primary: 'primary', accent: 'accent', red: '#dc2626', orange: '#ea580c', green: '#16a34a' };
const textRuns = (runs = [], t) => runs.map(r => `<span style="${r.bold ? 'font-weight:700;' : ''}${r.color ? `color:${t.tokens[colorToken[r.color]] || r.color};` : ''}">${escapeHtml(r.text)}</span>`).join('');
const base = t => `font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:${t.tokens.text};font-size:${t.tokens.bodySize}px;line-height:${t.tokens.lineHeight};letter-spacing:${t.tokens.letterSpacing}px;word-break:break-word;box-sizing:border-box;`;
const titleStyles = t => {
  const p=t.tokens.primary, text=t.tokens.text, on=t.tokens.onPrimary, radius=t.tokens.radius;
  return {
    'left-large':`font-size:28px;line-height:1.25;font-weight:800;color:${text};padding:0 0 18px;border-bottom:1px solid ${p};`,
    center:`font-size:28px;line-height:1.25;font-weight:800;color:${text};text-align:center;padding:12px 10px 20px;`,
    underline:`font-size:26px;line-height:1.3;font-weight:800;color:${text};padding-bottom:12px;border-bottom:3px solid ${p};`,
    bar:`font-size:24px;line-height:1.35;font-weight:800;color:${on};background-color:${p};padding:15px 16px;`,
    band:`font-size:25px;line-height:1.3;font-weight:800;color:${on};background-color:${p};padding:22px 16px;border-radius:${radius}px;`,
    frame:`font-size:25px;line-height:1.3;font-weight:800;color:${text};padding:18px;border:1px solid ${p};border-radius:${radius}px;`,
    masthead:`font-size:25px;line-height:1.3;font-weight:800;color:${text};padding:14px 0;border-top:3px solid ${p};border-bottom:1px solid ${p};`,
    tag:`font-size:26px;line-height:1.3;font-weight:800;color:${text};padding:26px 0 14px;`,
    split:`font-size:26px;line-height:1.3;font-weight:800;color:${text};padding-left:14px;border-left:4px solid ${p};`,
    stacked:`font-size:27px;line-height:1.25;font-weight:800;color:${text};padding:18px 0;`,
    pill:`font-size:25px;line-height:1.3;font-weight:800;color:${text};background-color:${t.tokens.tint};padding:13px 18px;border-radius:999px;`
  }[t.layout.titleLayout] || `font-size:26px;font-weight:800;color:${text};`;
};
const sectionMark = (mark, n, t) => {
  const number=String(n).padStart(2,'0'), p=t.tokens.primary, a=t.tokens.accent, on=t.tokens.onPrimary;
  const style={hairline:`border-top:1px solid ${p};padding-top:12px;`,'num-prefix':'padding-top:10px;','num-square':'padding-top:10px;','side-line':`border-left:3px solid ${p};padding-left:12px;`,tag:'padding-top:10px;','short-line':`border-top:3px solid ${p};padding-top:12px;`,'big-num':'padding-top:10px;',question:'padding-top:10px;',step:'padding-top:10px;','index-row':`border-top:1px solid ${p};padding-top:12px;`,dot:'padding-top:10px;',none:''}[mark] || '';
  const prefix={
    'num-prefix':`<span style="color:${a};font-size:13px;letter-spacing:1px;">${number} / </span>`,
    'num-square':`<span style="display:inline-block;background-color:${p};color:${on};padding:3px 7px;font-size:12px;margin-right:8px;">${number}</span>`,
    'big-num':`<span style="color:${a};font-size:34px;line-height:1;display:block;">${number}</span>`,
    question:`<span style="color:${a};font-size:13px;letter-spacing:1px;">问题</span><br/>`,
    step:`<span style="color:${a};font-size:13px;">步骤 ${number}</span><br/>`,
    tag:`<span style="display:inline-block;color:${on};background-color:${p};padding:3px 8px;font-size:12px;margin-bottom:8px;">章节</span><br/>`,
    dot:`<span style="color:${a};font-size:18px;margin-right:8px;">•</span>`,
    'index-row':`<span style="color:${a};font-size:12px;letter-spacing:1px;">${number}　/　章节</span><br/>`,
    'short-line':`<span style="color:${a};font-size:13px;">—</span><br/>`
  }[mark] || '';
  return {style,prefix};
};
const imageUrl=(asset,mode)=>{
  if(mode!=='preview'&&asset?.pasteStatus==='broken')return '';
  const candidates=mode==='preview'?[asset?.previewUrl,asset?.url]:[asset?.url];
  return candidates.find(v=>typeof v==='string'&&(v.startsWith('https://')||(mode==='preview'&&(v.startsWith('blob:')||v.startsWith('data:image/')||v.startsWith('/uploads/')))))||'';
};
const calloutCss=(t)=>{
  const style=t.layout.calloutStyle, primary=t.tokens.primary, accent=t.tokens.accent;
  const fill=['soft-fill','side-bar','rounded-fill'].includes(style)?`background-color:${t.tokens.tint};`:'';
  const color=style==='solid-fill'?`background-color:${primary};color:${t.tokens.onPrimary};`:'';
  const border=style==='double-frame'?`border:3px double ${primary};`:style==='gold-frame'?`border:1px solid ${accent};`:style==='dashed-frame'?`border:1px dashed ${primary};`:style==='thin-frame'?`border:1px solid ${primary};`:style==='side-bar'?`border-left:4px solid ${primary};`:'';
  const radius=style==='rounded-fill'?`border-radius:${t.tokens.radius}px;`:'';
  return `${fill}${color}${border}${radius}`;
};
const imageCard=(b,t,assets,mode)=>{
  const style=t.layout.cardStyle, url=imageUrl(assets.get(b.assetId),mode), p=t.tokens.primary, rad=t.tokens.radius;
  const image=url?`<img src="${escapeHtml(url)}" alt="${escapeHtml(b.caption||b.title||'文章图片')}" style="display:block;width:100%;height:auto;border-radius:${rad}px;" />`:`<p style="padding:24px 12px;background-color:${t.tokens.tint};text-align:center;color:${t.tokens.textMuted};">[图片待补充：${escapeHtml(b.caption||'请重新上传图片')}]</p>`;
  const title=b.title?`<p style="font-weight:700;margin:10px 0 4px;color:${style==='info'?p:t.tokens.text};">${escapeHtml(b.title)}</p>`:'';
  const caption=b.caption?`<p style="font-size:13px;color:${t.tokens.textMuted};text-align:center;margin:8px 0 0;">${escapeHtml(b.caption)}</p>`:'';
  const frame=['bordered','info','flow'].includes(style)?`border:1px solid ${p};`:'';
  const background=['story','info','flow'].includes(style)?`background-color:${t.tokens.tint};`:'';
  const padding=['compact'].includes(style)?'4px':'12px';
  const corner=['rounded','story'].includes(style)?rad:style==='plain'||style==='compact'?0:Math.min(rad,4);
  const imageFirst=style==='image-first'||style==='story';
  const content=imageFirst?`${image}${title}${caption}`:`${title}${image}${caption}`;
  const flow=style==='flow'?`<p style="font-size:12px;color:${p};margin:0 0 8px;">${escapeHtml(b.title||'STEP')}</p>`:'';
  return `<section style="${base(t)}margin:${t.tokens.sectionGap}px 0;padding:${padding};${background}${frame}border-radius:${corner}px;">${flow}${content}</section>`;
};
const renderBlock=(b,t,assets,headingIndex,mode)=>{
  const css=base(t), gap=t.tokens.paraGap, mark=sectionMark(t.layout.sectionMark,headingIndex,t);
  if(b.type==='heading')return `<section style="${css}margin:${t.tokens.sectionGap}px 0 ${gap}px;${b.level===1?mark.style:''}"><p style="${css}font-size:${b.level===1?'21px':'18px'};font-weight:700;margin:0;">${b.level===1?mark.prefix:''}${escapeHtml(b.text)}</p></section>`;
  if(b.type==='paragraph')return `<p style="${css}${t.id==='T03'||t.id==='T18'?'text-indent:2em;':''}margin:0 0 ${gap}px;">${textRuns(b.runs,t)}</p>`;
  if(b.type==='callout')return `<section style="${css}margin:${gap}px 0;padding:14px 16px;${calloutCss(t)}">${textRuns(b.runs,t)}</section>`;
  if(b.type==='quote')return `<section style="${css}margin:${gap}px 0;padding:14px 16px;border-left:3px solid ${t.tokens.accent};background-color:${t.tokens.tint};">${textRuns(b.runs,t)}${b.cite?`<p style="font-size:13px;color:${t.tokens.textMuted};margin:8px 0 0;">— ${escapeHtml(b.cite)}</p>`:''}</section>`;
  if(b.type==='list')return `<section style="${css}margin:0 0 ${gap}px;">${b.items.map((item,j)=>`<p style="margin:0 0 7px;">${b.ordered?`${j+1}.`:'•'} ${textRuns(item,t)}</p>`).join('')}</section>`;
  if(b.type==='divider')return `<p style="background-color:${t.tokens.primary};margin:${t.tokens.sectionGap}px 0;font-size:1px;">&nbsp;</p>`;
  if(b.type==='image'||b.type==='imageCard')return imageCard(b,t,assets,mode);
  return '';
};
const allowedTags=new Set(['section','p','span','strong','br','img']);
const allowedAttrs=new Set(['style','src','alt']);
const allowedCss=new Set(['color','background-color','font-size','font-weight','font-family','line-height','letter-spacing','text-align','text-indent','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','border','border-left','border-right','border-top','border-bottom','border-style','border-color','border-width','border-radius','width','max-width','height','display','box-sizing','vertical-align','word-break','white-space']);
export function assertSafeHtml(html){
  for(const match of html.matchAll(/<\/?([a-z0-9]+)([^>]*)>/gi)){const tag=match[1].toLowerCase();if(!allowedTags.has(tag))throw new Error(`HTML tag is not allowed: ${tag}`);for(const attr of match[2].matchAll(/([a-z-]+)\s*=/gi)){const name=attr[1].toLowerCase();if(!allowedAttrs.has(name))throw new Error(`HTML attribute is not allowed: ${name}`)}const style=match[2].match(/style="([^"]*)"/i)?.[1];if(style)for(const declaration of style.split(';').filter(Boolean)){const [name,value]=declaration.split(':');if(!allowedCss.has(name.trim().toLowerCase())||/url\s*\(|expression\s*\(|javascript:/i.test(value))throw new Error(`CSS declaration is not allowed: ${declaration}`)}const src=match[2].match(/src="([^"]*)"/i)?.[1];if(src&&!/^(https:\/\/|blob:|data:image\/(?:png|jpeg|webp);base64,|\/uploads\/)/i.test(src))throw new Error('Image URL is not allowed')}
  return html;
}
export function renderArticle(article,template,assets=new Map(),opts={}){
  let headingIndex=0;
  const inner=article.blocks.map(b=>{if(b.type==='heading'&&b.level===1)headingIndex++;return renderBlock(b,template,assets,headingIndex,opts.mode||'wechat')}).join('');
  const title=article.title?`<p style="${titleStyles(template)}margin:0 0 20px;">${escapeHtml(article.title)}</p>`:'';
  const html=assertSafeHtml(`<section style="max-width:100%;padding:18px 16px;background-color:#ffffff;box-sizing:border-box;">${title}${inner}</section>`);
  const plainBlocks=article.blocks.map(b=>b.type==='image'||b.type==='imageCard'?`[图片：${b.caption||b.title||'文章图片'}]`:blockText(b));
  const text=[article.title,...plainBlocks].filter(Boolean).join('\n\n');
  const images=article.blocks.filter(b=>b.type==='image'||b.type==='imageCard').map(b=>({assetId:b.assetId,caption:b.caption||b.title||''}));
  return {html,text,images};
}
