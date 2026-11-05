import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import pdfjs from 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js';
import sharp from 'sharp';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ArticleSchema, uid } from '../src/core.js';
import { templates } from '../src/templates.js';
import { markdownBlocks, normalizeDraft } from '../src/content.js';
import { GENERATION_TIMEOUT_MS, TARGET_LENGTHS, WRITING_TONES } from '../src/creation.js';
import { generationInstructions, inspectDraft, preferDraft, protectedFragments } from './writing-rules.js';
import { recommendTemplates } from '../src/recommender.js';
import { DomUtils, parseDocument } from 'htmlparser2';
import { fetchModels, getAIConfig, getAIStatus, resetAIConfig, resolveAIConfig, resolveCredentials, saveAIConfig } from './ai-config.js';
import { fetchRemoteImage, MAX_IMAGE_BYTES } from './remote-image.js';
import { clearArticleStyles, layoutSource, LAYOUT_TIMEOUT_MS, validateLayoutDesign } from '../src/layout-design.js';
import { renderArticle } from '../src/renderer.js';
import { layoutInstructions } from './layout-rules.js';
import { AIEditRequestSchema, AIEditResponseSchema, AI_EDIT_TIMEOUT_MS, buildAIEdit, describeAIEdit, isImageBlock } from '../src/ai-edit.js';
import { editInstructions } from './edit-rules.js';
import { htmlEditInstructions } from './html-edit-rules.js';
import { normalizeUsage, usageMeta } from './ai-usage.js';

dotenv.config();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uploadDir = process.env.ASSET_DIR ? path.resolve(process.env.ASSET_DIR) : path.join(root, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const MAX_EDIT_IMAGES = 10;
const MAX_EDIT_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_EDIT_DOCUMENT_CHARS = 200_000;
const oneMinute = new Map();
let activeGenerations = 0;
const resolvedApiStyles = new Map();
let activeImageImports = 0;

app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = process.env.ALLOWED_ORIGIN?.split(',').map(value => value.trim()) || ['http://localhost:5173', 'http://127.0.0.1:5173'];
  if (origin && allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data: blob:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-src 'self' about:; base-uri 'self'; object-src 'none'");
  const requestId = crypto.randomUUID();
  res.setHeader('X-Request-Id', requestId);
  const start = Date.now();
  res.once('finish', () => console.info(JSON.stringify({ requestId, route: req.route?.path || req.path, method: req.method, status: res.statusCode, durationMs: Date.now() - start, ...(res.locals.modelUsages ? usageMeta(res.locals.modelUsages) : {}), ...(res.locals.modelFailure ? { modelFailure: res.locals.modelFailure } : {}) })));
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  next();
});
app.use('/uploads', express.static(uploadDir, { fallthrough: false, maxAge: '1h' }));

function rateLimit(defaultLimit, setting) {
  return (req, res, next) => {
    const limit = Number(process.env[setting] || defaultLimit);
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const state = oneMinute.get(key) || { start: now, count: 0 };
    if (now - state.start >= 60_000) { state.start = now; state.count = 0; }
    if (++state.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((60_000 - (now - state.start)) / 1000))));
      return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '请求过于频繁，请稍后再试' } });
    }
    oneMinute.set(key, state);
    next();
  };
}
const concurrentGenerationLimit = (req, res, next) => {
  if (activeGenerations >= 2) {
    res.setHeader('Retry-After', '5');
    return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '生成任务较多，请稍后再试' } });
  }
  activeGenerations++;
  let released = false;
  const release = () => { if (!released) { released = true; activeGenerations--; } };
  res.once('finish', release);
  res.once('close', release);
  next();
};
const waitFor = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('parse timeout')), ms))]);
const publicAssetUrl = filename => `${String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '')}/uploads/${filename}`;
const imageAssetExists = id => /^[a-zA-Z0-9_-]{1,80}$/.test(id) && fs.readdirSync(uploadDir).some(name => name.startsWith(`${id}.`));
const inlineRuns = nodes => {
  const runs = [];
  const visit = (children, bold = false) => {
    for (const node of children || []) {
      if (node.type === 'text') {
        if (node.data) runs.push({ text: node.data, ...(bold ? { bold: true } : {}) });
      } else if (node.name === 'br') {
        runs.push({ text: '\n', ...(bold ? { bold: true } : {}) });
      } else {
        visit(node.children, bold || node.name === 'strong' || node.name === 'b');
      }
    }
  };
  visit(nodes);
  return runs.filter(run => run.text);
};
function blocksFromDocxHtml(html) {
  const root = parseDocument(html);
  const blocks = [];
  let ignoredImages = 0;
  const visit = nodes => {
    for (const node of nodes || []) {
      if (node.type !== 'tag') continue;
      if (node.name === 'img') { ignoredImages++; continue; }
      if (['h1', 'h2', 'h3'].includes(node.name)) {
        const text = DomUtils.textContent(node).trim();
        if (text.length && text.length <= 40) blocks.push({ id: uid('b'), type: 'heading', level: node.name === 'h1' ? 1 : 2, text });
        else if (text) blocks.push({ id: uid('b'), type: 'paragraph', runs: [{ text }] });
      } else if (node.name === 'p') {
        const runs = inlineRuns(node.children);
        if (runs.some(run => run.text.trim())) blocks.push({ id: uid('b'), type: 'paragraph', runs });
      } else if (node.name === 'blockquote') {
        const runs = inlineRuns(node.children);
        if (runs.some(run => run.text.trim())) blocks.push({ id: uid('b'), type: 'quote', runs });
      } else if (node.name === 'ul' || node.name === 'ol') {
        const items = (node.children || []).filter(child => child.name === 'li').map(item => inlineRuns(item.children)).filter(runs => runs.some(run => run.text.trim())).slice(0, 30);
        if (items.length) blocks.push({ id: uid('b'), type: 'list', ordered: node.name === 'ol', items });
      } else {
        visit(node.children);
      }
    }
  };
  visit(root.children);
  const text = blocks.map(block => block.type === 'heading' ? block.text : block.type === 'list' ? block.items.map(runs => runs.map(run => run.text).join('')).join('\n') : block.runs.map(run => run.text).join('')).join('\n\n');
  return { blocks, text, ignoredImages };
}

async function extractPdfImages(page, maxImages) {
  const pdf = pdfjs.PDFJS;
  const list = await page.getOperatorList();
  const images = [];
  const seen = new Set();
  let omittedImages = 0;
  for (let index = 0; index < list.fnArray.length; index++) {
    const operation = list.fnArray[index];
    const args = list.argsArray[index] || [];
    let image;
    let key;
    if ([pdf.OPS.paintImageXObject, pdf.OPS.paintJpegXObject, pdf.OPS.paintImageXObjectRepeat].includes(operation)) {
      key = String(args[0]);
      image = await new Promise(resolve => page.objs.get(args[0], resolve));
    } else if (operation === pdf.OPS.paintInlineImageXObject) image = args[0];
    if (!image?.data || !image.width || !image.height) continue;
    const raw = Buffer.from(image.data.buffer || image.data, image.data.byteOffset || 0, image.data.byteLength || image.data.length);
    key ||= crypto.createHash('sha256').update(raw).digest('hex');
    if (seen.has(key)) continue;
    seen.add(key);
    if (images.length >= maxImages) { omittedImages++; continue; }
    const channels = raw.length / (image.width * image.height);
    try {
      const buffer = Number.isInteger(channels) && channels >= 1 && channels <= 4
        ? await sharp(raw, { raw: { width: image.width, height: image.height, channels } }).png().toBuffer()
        : await sharp(raw).png().toBuffer();
      images.push(buffer);
    } catch { omittedImages++; }
  }
  return { images, omittedImages };
}

async function parsePdfAttachment(buffer) {
  pdfjs.PDFJS.disableFontFace = true;
  const images = [];
  let omittedImages = 0;
  const originalImage = globalThis.Image;
  if (!originalImage) globalThis.Image = class {
    set src(value) {
      const data = Buffer.from(String(value).split(',').at(-1), 'base64');
      sharp(data).removeAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data: pixels, info }) => {
        this.width = info.width;
        this.height = info.height;
        this.data = pixels;
        this.onload?.();
      }).catch(() => this.onerror?.());
    }
  };
  try {
    const parsed = await waitFor(pdfParse(buffer, {
      max: 200,
      pagerender: async page => {
        const text = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
        try {
          const extracted = await extractPdfImages(page, MAX_EDIT_IMAGES - images.length);
          images.push(...extracted.images);
          omittedImages += extracted.omittedImages;
        } catch {}
        let lastY, result = '';
        for (const item of text.items) {
          result += lastY === item.transform[5] || !lastY ? item.str : `\n${item.str}`;
          lastY = item.transform[5];
        }
        return result;
      },
    }), 15_000);
    if (parsed.numpages > 200) throw new Error('page limit');
    return { text: parsed.text, images, omittedImages };
  } finally { if (!originalImage) delete globalThis.Image; }
}

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '0.1.0' }));
const configError = (res, error) => res.status(error.status || 400).json({ error: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || 'AI 配置操作失败' } });
const canWriteConfig = req => {
  const origin = req.get('origin');
  if (!origin) return true;
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0].trim();
  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0].trim();
  const requestHost = (forwardedHost || req.get('host') || '').toLowerCase();
  const requestProtocol = (forwardedProtocol || req.protocol).replace(/:$/, '').toLowerCase();
  let sameOrigin = false;
  try {
    const parsedOrigin = new URL(origin);
    sameOrigin = parsedOrigin.host.toLowerCase() === requestHost && parsedOrigin.protocol === `${requestProtocol}:`;
  } catch {}
  const allowedOrigins = (process.env.ALLOWED_ORIGIN?.split(',') || ['http://localhost:5173', 'http://127.0.0.1:5173']).map(value => value.trim()).filter(Boolean);
  return sameOrigin || allowedOrigins.includes(origin);
};
app.get('/api/config/status', async (req, res) => {
  try {
    const config = getAIConfig();
    if (config.baseUrl && config.apiKey && !config.model) {
      try { await resolveAIConfig(); }
      catch (error) { return res.json({ ...getAIStatus(), configurationError: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || '无法获取模型列表' } }); }
    }
    const status = getAIStatus();
    const partial = status.source !== 'none' && !(status.baseUrl && status.hasApiKey && status.model);
    return res.json({ ...status, ...(partial ? { configurationError: { code: 'AI_CONFIG_INCOMPLETE', message: 'AI 服务配置不完整，请填写服务 URL、API Key 并选择模型' } } : {}) });
  } catch (error) {
    return res.json({
      aiConfigured: false,
      baseUrl: '',
      hasApiKey: Boolean(process.env.AI_API_KEY),
      model: '',
      models: [],
      source: 'environment',
      configurationError: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || 'AI 服务配置无效' }
    });
  }
});
app.post('/api/config/models', rateLimit(20, 'RATE_CONFIG_PER_MIN'), async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '当前页面来源未被服务端允许，请配置 ALLOWED_ORIGIN 或检查反向代理来源信息' } });
  try {
    const credentials = resolveCredentials(req.body);
    const models = await fetchModels(credentials);
    res.json({ baseUrl: credentials.baseUrl, models });
  } catch (error) { configError(res, error); }
});
app.post('/api/config/ai', rateLimit(20, 'RATE_CONFIG_PER_MIN'), async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '当前页面来源未被服务端允许，请配置 ALLOWED_ORIGIN 或检查反向代理来源信息' } });
  try {
    const credentials = resolveCredentials(req.body);
    const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
    if (!model || model.length > 256) throw Object.assign(new Error('请选择有效的模型'), { code: 'INVALID_MODEL' });
    const models = await fetchModels(credentials);
    if (!models.includes(model)) throw Object.assign(new Error('所选模型已失效，请重新获取模型列表'), { code: 'INVALID_MODEL' });
    await saveAIConfig({ ...credentials, model, models, source: 'custom' });
    res.json(getAIStatus());
  } catch (error) { configError(res, error); }
});
app.delete('/api/config/ai', async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '此来源不能修改 AI 配置' } });
  try {
    await resetAIConfig();
    const config = getAIConfig();
    if (config.baseUrl && config.apiKey && !config.model) await resolveAIConfig();
    res.json(getAIStatus());
  } catch (error) { configError(res, error); }
});
app.get('/api/templates', (req, res) => res.json({ version: '2.1.0', templates }));

app.post('/api/materials/parse', rateLimit(20, 'RATE_PARSE_PER_MIN'), upload.array('files', 5), async (req, res) => {
  const files = [];
  for (const file of req.files || []) {
    try {
      const extension = path.extname(file.originalname).toLowerCase();
      const buffer = file.buffer;
      let text = '';
      let blocks;
      let imageCount = 0;
      if (extension === '.txt' || extension === '.md') {
        text = new TextDecoder('utf-8').decode(buffer);
        if (text.includes('\uFFFD')) text = new TextDecoder('gbk').decode(buffer);
      } else if (extension === '.docx' && buffer[0] === 0x50 && buffer[1] === 0x4b) {
        const converted = await waitFor(mammoth.convertToHtml({ buffer }), 15_000);
        const structured = blocksFromDocxHtml(converted.value);
        blocks = structured.blocks;
        text = structured.text;
        imageCount = structured.ignoredImages;
      } else if (extension === '.pdf' && buffer.subarray(0, 5).toString() === '%PDF-') {
        const parsed = await waitFor(pdfParse(buffer, { max: 200 }), 15_000);
        if (parsed.numpages > 200) throw new Error('page limit');
        text = parsed.text;
      } else {
        throw new Error('unsupported type or signature');
      }
      const withoutWhitespace = text.replace(/\s/g, '');
      const badChars = (text.match(/[\uFFFD\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
      if (withoutWhitespace.length < 20 || badChars / Math.max(text.length, 1) > 0.05) throw new Error('extraction quality too low');
      files.push({ name: path.basename(file.originalname).slice(0, 240), ok: true, text, charCount: text.length, preview: text.slice(0, 200), ...(blocks ? { blocks } : {}), ...(imageCount ? { warnings: ['文档中的图片未导入，请单独上传'], imageCount } : {}) });
    } catch {
      files.push({ name: path.basename(file.originalname).slice(0, 240), ok: false, error: '无法读取文本，请粘贴文字' });
    }
  }
  res.json({ files });
});

app.post('/api/articles/edit/attachments', rateLimit(60, 'RATE_EDIT_ATTACHMENTS_PER_MIN'), upload.single('file'), async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '当前页面来源未被服务端允许' } });
  const file = req.file;
  if (!file) return res.status(400).json({ error: { code: 'INVALID_ATTACHMENT', message: '请选择图片或文档' } });
  const name = path.basename(file.originalname).slice(0, 240);
  const extension = path.extname(name).toLowerCase();
  if (['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) {
    if (file.size > 10 * 1024 * 1024) return res.status(413).json({ error: { code: 'FILE_TOO_LARGE', message: '图片不能超过10 MB' } });
    try {
      const asset = await cacheImage(file.buffer);
      return res.json({ attachment: { kind: 'image', name, assetId: asset.id, cacheUrl: asset.cacheUrl, mime: asset.mime, bytes: asset.bytes } });
    } catch (error) {
      return res.status(400).json({ error: { code: error.code || 'INVALID_IMAGE', message: error.message || '图片无法处理' } });
    }
  }
  if (!['.pdf', '.docx', '.txt', '.md'].includes(extension)) return res.status(400).json({ error: { code: 'UNSUPPORTED_ATTACHMENT', message: '仅支持 JPG、PNG、WebP、PDF、DOCX、TXT 和 MD' } });

  let text = '';
  let imageBuffers = [];
  let omittedImages = 0;
  try {
    if (extension === '.txt' || extension === '.md') {
      text = new TextDecoder('utf-8').decode(file.buffer);
      if (text.includes('\uFFFD')) text = new TextDecoder('gbk').decode(file.buffer);
    } else if (extension === '.docx' && file.buffer[0] === 0x50 && file.buffer[1] === 0x4b) {
      let totalImageBytes = 0;
      const converted = await waitFor(mammoth.convertToHtml({ buffer: file.buffer }, {
        convertImage: mammoth.images.imgElement(async image => {
          const imageBuffer = await image.read();
          if (imageBuffers.length >= MAX_EDIT_IMAGES || totalImageBytes + imageBuffer.length > MAX_EDIT_IMAGE_BYTES) {
            omittedImages++;
            return { src: '' };
          }
          totalImageBytes += imageBuffer.length;
          imageBuffers.push(imageBuffer);
          return { src: `attachment-image:${imageBuffers.length}` };
        }),
      }), 15_000);
      text = blocksFromDocxHtml(converted.value).text;
    } else if (extension === '.pdf' && file.buffer.subarray(0, 5).toString() === '%PDF-') {
      const parsed = await parsePdfAttachment(file.buffer);
      text = parsed.text;
      imageBuffers = parsed.images;
      omittedImages = parsed.omittedImages;
    } else {
      return res.status(400).json({ error: { code: 'UNREADABLE_DOCUMENT', message: '文档无法读取' } });
    }
    const extractedTextLength = text.replace(/\s/g, '').length;
    if (!text.trim() && !imageBuffers.length) return res.status(422).json({ error: { code: 'UNREADABLE_DOCUMENT', message: '文档中没有可用文字或图片' } });
    if (extension === '.pdf' && extractedTextLength < 20) return res.status(422).json({ error: { code: 'UNREADABLE_DOCUMENT', message: '未提取到足够的文字，不支持扫描版 PDF 或图片文字识别' } });
    if (text.length > MAX_EDIT_DOCUMENT_CHARS) return res.status(413).json({ error: { code: 'DOCUMENT_TOO_LARGE', message: '文档文字超过20万字，请拆分后上传' } });
    const images = [];
    let imageBytes = 0;
    for (const [index, imageBuffer] of imageBuffers.entries()) {
      if (imageBytes + imageBuffer.length > MAX_EDIT_IMAGE_BYTES) { omittedImages++; continue; }
      try {
        const asset = await cacheImage(imageBuffer);
        imageBytes += asset.bytes;
        images.push({ assetId: asset.id, name: `${name} 图片 ${index + 1}`, cacheUrl: asset.cacheUrl, mime: asset.mime, bytes: asset.bytes });
      } catch { omittedImages++; }
    }
    return res.json({ attachment: { kind: 'document', name, text, charCount: text.length, images, ...(omittedImages ? { warning: `有${omittedImages}张内嵌图片无法提取或超过附件上限` } : {}) } });
  } catch {
    return res.status(422).json({ error: { code: 'UNREADABLE_DOCUMENT', message: '文档无法读取，请确认文件完整；扫描版 PDF 不支持识别' } });
  }
});

async function cacheImage(buffer, sourceUrl) {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw Object.assign(new Error('图片为空或超过 10MB'), { code: 'IMAGE_TOO_LARGE', status: 400 });
  const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
  const format = { jpeg: { mime: 'image/jpeg', extension: 'jpg' }, png: { mime: 'image/png', extension: 'png' }, webp: { mime: 'image/webp', extension: 'webp' } }[metadata.format];
  if (!format) throw Object.assign(new Error('仅支持 JPG、PNG 和 WebP 图片'), { code: 'INVALID_IMAGE', status: 400 });
  if (!metadata.width || !metadata.height || metadata.width > 8000 || metadata.height > 8000) throw Object.assign(new Error('图片尺寸过大'), { code: 'DIMENSION_EXCEEDED', status: 400 });
  const id = uid('img');
  const filename = `${id}.${format.extension}`;
  const normalized = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  if (normalized.info.size > MAX_IMAGE_BYTES) throw Object.assign(new Error('图片处理后超过 10MB'), { code: 'IMAGE_TOO_LARGE', status: 400 });
  await fs.promises.writeFile(path.join(uploadDir, filename), normalized.data);
  const cacheUrl = `/uploads/${filename}`;
  const publicUrl = publicAssetUrl(filename);
  return { id, filename, mime: format.mime, width: normalized.info.width, height: normalized.info.height, bytes: normalized.info.size, cacheUrl, url: sourceUrl && !/^https:\/\//i.test(publicUrl) ? sourceUrl : publicUrl, ...(sourceUrl ? { sourceUrl } : {}), expiresAt: new Date(Date.now() + Number(process.env.ASSET_TTL_DAYS || 7) * 86_400_000).toISOString(), pasteStatus: 'needs-manual' };
}

app.post('/api/assets/import', rateLimit(20, 'RATE_IMPORT_PER_MIN'), async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '此来源不能导入图片' } });
  if (activeImageImports >= 2) return res.status(429).json({ error: { code: 'RATE_LIMITED', message: '正在读取其他图片，请稍后重试' } });
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  activeImageImports++;
  try {
    const { buffer, sourceUrl } = await fetchRemoteImage(req.body?.url, controller.signal);
    const asset = await cacheImage(buffer, sourceUrl);
    if (!controller.signal.aborted) res.json({ asset });
  } catch (error) {
    if (!controller.signal.aborted) res.status(error.status || 400).json({ error: { code: error.code || 'INVALID_IMAGE', message: error.status ? error.message : '图片无法处理，请使用 JPG、PNG 或 WebP 直链' } });
  } finally { activeImageImports--; }
});

app.post('/api/assets', rateLimit(60, 'RATE_ASSETS_PER_MIN'), upload.single('file'), async (req, res) => {
  try {
    const imageExtension = req.file ? path.extname(req.file.originalname).toLowerCase() : '';
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.webp'];
    if (!req.file || req.file.size > 10 * 1024 * 1024 || !supportedExtensions.includes(imageExtension)) {
      return res.status(400).json({ error: { code: req.file?.size > 10 * 1024 * 1024 ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE', message: '图片格式不支持或超过 10MB' } });
    }
    res.json({ asset: await cacheImage(req.file.buffer) });
  } catch (error) {
    res.status(error.status || 400).json({ error: { code: error.code || 'INVALID_IMAGE', message: error.status ? error.message : '图片无法处理' } });
  }
});

app.delete('/api/assets/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return res.status(400).json({ error: { code: 'INVALID_ID', message: '资源编号无效' } });
  const matches = fs.readdirSync(uploadDir).filter(name => name.startsWith(`${id}.`));
  if (!matches.length) return res.status(404).json({ error: { code: 'NOT_FOUND', message: '图片资源不存在' } });
  for (const name of matches) fs.rmSync(path.join(uploadDir, name), { force: true });
  res.status(204).end();
});

const modelResult = data => ({ text: data.output_text || data.choices?.[0]?.message?.content || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text || '', usage: normalizeUsage(data.usage) });
const isUnsupportedVisionRequest = error => {
  const detail = `${error?.message || ''} ${error?.upstreamMessage || ''}`;
  return /(?:image|vision|multimodal|input_image|image_url).{0,100}(?:not supported|unsupported|not support|unavailable|disabled)|(?:not supported|unsupported|not support|unavailable|disabled).{0,100}(?:image|vision|multimodal|input_image|image_url)/i.test(detail);
};
async function requestModel({ config, system, source, topic, mode, tone, targetLength, assetIds, template, signal, previousError, revision, inputData, imageInputs = [] }) {
  const base = config.baseUrl;
  const style = process.env.AI_API_STYLE || 'auto';
  const cacheKey = `${base}\0${crypto.createHash('sha256').update(config.apiKey).digest('hex')}\0${config.model}`;
  const resolvedApiStyle = resolvedApiStyles.get(cacheKey);
  const templateContentGuide = template ? { preferredBlocks: template.fit.preferredBlocks, headingLevels: [1, 2], missingContent: 'omit', priority: 'below-writing-rules' } : undefined;
  const input = JSON.stringify(inputData || { task: mode === 'polish' ? '润色文章，保留事实与重要细节及叙事顺序' : '基于主题和素材创作文章', mode, topic, source, imageAssetIds: assetIds, tone, targetLength, templateContentGuide, revision, schemaVersion: 1, previousValidationError: previousError || undefined });
  const responsesUserContent = [{ type: 'input_text', text: input }, ...imageInputs.flatMap(image => [
    { type: 'input_text', text: `附件图片：${image.name}` },
    { type: 'input_image', image_url: `data:${image.mime};base64,${image.buffer.toString('base64')}` },
  ])];
  const chatUserContent = imageInputs.length ? [{ type: 'text', text: input }, ...imageInputs.flatMap(image => [
    { type: 'text', text: `附件图片：${image.name}` },
    { type: 'image_url', image_url: { url: `data:${image.mime};base64,${image.buffer.toString('base64')}` } },
  ])] : input;
  const responsesBody = { model: config.model, input: [{ role: 'system', content: [{ type: 'input_text', text: system }] }, { role: 'user', content: responsesUserContent }], text: { format: { type: 'json_object' } } };
  const chatBody = { model: config.model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: chatUserContent }] };
  const request = async (kind, body) => {
    const timeout = AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 90_000));
    return fetch(`${base}/${kind === 'responses' ? 'responses' : 'chat/completions'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  };
  const upstreamFailure = async response => {
    const upstreamMessage = (await response.text()).slice(0, 2000);
    let upstreamCode;
    try { upstreamCode = JSON.parse(upstreamMessage).error?.code; } catch { /* non-JSON upstream errors have no code */ }
    return Object.assign(new Error(`upstream ${response.status}`), { status: response.status, upstreamCode, upstreamMessage });
  };
  if (style === 'responses' || style === 'chat') {
    const kind = style;
    const response = await request(kind, kind === 'responses' ? responsesBody : chatBody);
    if (!response.ok) throw await upstreamFailure(response);
    return modelResult(await response.json());
  }
  if (style === 'auto' && resolvedApiStyle === 'chat') {
    const response = await request('chat', chatBody);
    if (!response.ok) throw await upstreamFailure(response);
    return modelResult(await response.json());
  }
  const response = await request('responses', responsesBody);
  if (response.ok) { resolvedApiStyles.set(cacheKey, 'responses'); return modelResult(await response.json()); }
  const bodyText = await response.text();
  const unsupported = [400, 404, 405, 422].includes(response.status) && (/unsupported|not found|unknown|not support/i.test(bodyText) || response.status === 404 || response.status === 405);
  if (!unsupported) throw Object.assign(new Error(`upstream ${response.status}`), { status: response.status });
  const chatResponse = await request('chat', chatBody);
  if (!chatResponse.ok) throw await upstreamFailure(chatResponse);
  resolvedApiStyles.set(cacheKey, 'chat');
  return modelResult(await chatResponse.json());
}
function mockDraft(title, source, assetIds) {
  const fallback = [
    `围绕“${title}”展开，先明确读者正在面对的问题，再按内容顺序整理已有信息。`,
    '把素材中的背景、变化和重点分别梳理，读者可以顺着段落逐步理解主题。',
    '编辑时保留原有事实与语气，尚未确认的信息不补充具体数字或来源。',
    '发布前检查内容准确性，并根据读者需要补充可执行的下一步。'
  ];
  const blocks = source.trim() ? markdownBlocks(source) : [
    { id: uid('b'), type: 'heading', level: 1, text: '先看这件事的背景' },
    ...fallback.slice(0, 2).map(text => ({ id: uid('b'), type: 'paragraph', runs: [{ text }] })),
    { id: uid('b'), type: 'heading', level: 1, text: '把重点整理清楚' },
    ...fallback.slice(2).map(text => ({ id: uid('b'), type: 'paragraph', runs: [{ text }] }))
  ];
  for (const assetId of assetIds) blocks.push({ id: uid('b'), type: 'imageCard', assetId, caption: '' });
  return { title, summary: `围绕${title}整理的编辑参考摘要`, blocks };
}

app.post('/api/articles/generate', rateLimit(10, 'RATE_GENERATE_PER_MIN'), concurrentGenerationLimit, async (req, res) => {
  const { mode = 'create', topic = '', text = '', materials = [], tone = 'plain', targetLength = 1000, assetIds = [], templateId } = req.body || {};
  const validModes = ['create', 'polish'];
  if (!validModes.includes(mode)) return res.status(400).json({ error: { code: 'INVALID_MODE', message: '创作方式无效' } });
  if (typeof topic !== 'string' || typeof text !== 'string' || !Array.isArray(materials) || materials.some(value => typeof value !== 'string') || !Array.isArray(assetIds) || assetIds.length > 10) return res.status(400).json({ error: { code: 'INVALID_INPUT', message: '输入内容格式无效' } });
  if (typeof tone !== 'string' || !Object.hasOwn(WRITING_TONES, tone) || !TARGET_LENGTHS.includes(targetLength)) return res.status(400).json({ error: { code: 'INVALID_SETTINGS', message: '文章设置无效' } });
  if (templateId !== undefined && !templates.some(template => template.id === templateId)) return res.status(400).json({ error: { code: 'INVALID_TEMPLATE', message: '模板不存在' } });
  const source = [text, ...materials].filter(Boolean).join('\n\n');
  if (source.length > 30_000) return res.status(400).json({ error: { code: 'INPUT_TOO_LONG', message: '素材总量超过 30,000 字' } });
  if (mode === 'polish' && !source.trim()) return res.status(400).json({ error: { code: 'INPUT_EMPTY', message: '请先添加正文或文档素材' } });
  if (mode === 'create' && !topic.trim() && !source.trim()) return res.status(400).json({ error: { code: 'INPUT_EMPTY', message: '请输入主题或上传/粘贴素材' } });
  if (mode === 'create' && !source.trim() && topic.trim().length < 5) return res.status(400).json({ error: { code: 'TOPIC_TOO_SHORT', message: '主题至少 5 个字符' } });
  if (new Set(assetIds).size !== assetIds.length || assetIds.some(id => !imageAssetExists(id))) return res.status(400).json({ error: { code: 'INVALID_ASSET', message: '部分图片已失效，请重新上传' } });
  const title = (topic.trim() || source.trim().split(/\n/)[0] || '未命名文章').slice(0, 64);
  const startedAt = Date.now();
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(GENERATION_TIMEOUT_MS)]);
  let aiConfig = getAIConfig();
  const hasAISettings = Boolean(aiConfig.baseUrl || aiConfig.apiKey || aiConfig.model);
  if (hasAISettings) {
    if (!aiConfig.baseUrl || !aiConfig.apiKey) return res.status(400).json({ error: { code: 'AI_CONFIG_INCOMPLETE', message: 'AI 服务配置不完整，请检查服务 URL 和 API Key' } });
    try { aiConfig = await resolveAIConfig(); }
    catch (error) { return res.status(error.status || 502).json({ error: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || '无法获取模型列表' } }); }
    if (!aiConfig.model) return res.status(400).json({ error: { code: 'AI_CONFIG_INCOMPLETE', message: 'AI 服务配置不完整，请选择模型' } });
  }
  const useAI = hasAISettings;
  let draft = null;
  let model = 'local-mock';
  let retried = false;
  const usages = res.locals.modelUsages = [];
  let lastError;
  let report;
  const protectedParts = mode === 'polish' ? protectedFragments(source) : [];
  if (useAI) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal.aborted) break;
      retried = attempt > 0;
      usages.push(normalizeUsage());
      try {
        const output = await requestModel({ config: aiConfig, system: generationInstructions({ mode, tone, targetLength }), source, topic, mode, tone, targetLength, assetIds, template: templates.find(template => template.id === templateId), signal, previousError: lastError?.message, revision: draft ? { draft, issues: report.issues, actualBodyChars: report.length.actual } : undefined });
        usages[attempt] = output.usage;
        const next = normalizeDraft(output.text, assetIds);
        const nextReport = inspectDraft(next, { targetLength, protectedParts });
        if (preferDraft(nextReport, report)) { draft = next; report = nextReport; }
        model = aiConfig.model;
        if (!report.issues.length) break;
      } catch (error) {
        if (controller.signal.aborted) return;
        lastError = error;
      }
    }
    if (controller.signal.aborted) return;
    if (!draft) {
      const timeout = signal.aborted || lastError?.name === 'TimeoutError' || lastError?.name === 'AbortError';
      const upstream = lastError?.status && lastError.status >= 500;
      return res.status(timeout ? 504 : 502).json({ error: { code: timeout ? 'AI_TIMEOUT' : upstream ? 'AI_UPSTREAM_ERROR' : 'AI_INVALID_OUTPUT', message: '生成暂时未完成，请重试' } });
    }
  } else {
    try { draft = normalizeDraft(mockDraft(title, source, assetIds), assetIds); }
    catch { return res.status(422).json({ error: { code: 'CONTENT_STRUCTURE_INVALID', message: '素材段落过多或缺少正文，请精简内容后重试' } }); }
  }
  const candidate = {
    schemaVersion: 1, id: uid('article'), mode, title: String(draft.title || title).slice(0, 64),
    summary: draft.summary, blocks: draft.blocks, templateId: templateId || 'T01',
    settings: { tone, targetLength, aiGenerated: useAI, mockGenerated: !useAI },
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  const parsed = ArticleSchema.safeParse(candidate);
  if (!parsed.success) return res.status(502).json({ error: { code: 'AI_INVALID_OUTPUT', message: '生成内容格式异常，请重试' } });
  const referenced = new Set(parsed.data.blocks.filter(block => block.type === 'image' || block.type === 'imageCard').map(block => block.assetId));
  for (const assetId of assetIds) if (!referenced.has(assetId)) {
    parsed.data.blocks.push({ id: uid('b'), type: 'imageCard', assetId, caption: '' });
  }
  if (!templateId) parsed.data.templateId = recommendTemplates(parsed.data)[0]?.id || 'T01';
  res.json({ article: parsed.data, meta: { promptVersion: useAI ? 'semantic-3' : 'mock-2', schemaVersion: 1, model, latencyMs: Date.now() - startedAt, retried, ...usageMeta(usages), ...(report ? { length: report.length, protectedMissingCount: report.missing.length } : {}) } });
});

app.post('/api/articles/design', rateLimit(10, 'RATE_DESIGN_PER_MIN'), concurrentGenerationLimit, async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '当前页面来源未被服务端允许' } });
  const { mode, prompt = '' } = req.body || {};
  const parsed = ArticleSchema.pick({ title: true, summary: true, blocks: true }).safeParse(req.body?.article);
  if (!parsed.success || !['auto', 'prompt'].includes(mode) || typeof prompt !== 'string' || prompt.length > 1000 || (mode === 'prompt' && !prompt.trim())) return res.status(400).json({ error: { code: 'INVALID_DESIGN_INPUT', message: '请提供有效文章、设计方式和不超过1000字的风格要求' } });
  const article = parsed.data;
  const content = layoutSource(article);
  if (!content.some(item => item.text?.trim() || item.items?.some(text => text.trim()))) return res.status(400).json({ error: { code: 'CONTENT_EMPTY', message: '请先添加文章内容' } });
  if (new Set(content.map(item => item.ref)).size !== content.length) return res.status(400).json({ error: { code: 'INVALID_CONTENT_REFS', message: '文章内容编号重复，请恢复草稿后重试' } });
  if (JSON.stringify(content).length > 180_000) return res.status(400).json({ error: { code: 'CONTENT_TOO_LONG', message: '文章过长，请分篇后设计；全文不会被截断提交' } });
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(LAYOUT_TIMEOUT_MS)]);
  let config;
  try { config = await resolveAIConfig(); }
  catch (error) { return res.status(error.status || 502).json({ error: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || '无法连接 AI 服务' } }); }
  if (!config.baseUrl || !config.apiKey || !config.model) return res.status(400).json({ error: { code: 'AI_NOT_CONFIGURED', message: '请先在顶部设置中配置 AI 服务' } });
  const usages = res.locals.modelUsages = [];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) break;
    usages.push(normalizeUsage());
    try {
      const output = await requestModel({ config, system: layoutInstructions, signal, inputData: { mode, designPrompt: mode === 'prompt' ? prompt.trim() : undefined, content, previousValidationError: lastError?.message.slice(0, 800) } });
      usages[attempt] = output.usage;
      const value = JSON.parse(output.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/, '$1'));
      const design = validateLayoutDesign(value, article);
      renderArticle({ ...clearArticleStyles(article), layoutDesign: design }, templates[0]);
      if (!controller.signal.aborted) return res.json({ design, meta: { model: config.model, retried: attempt > 0, ...usageMeta(usages) } });
      return;
    } catch (error) {
      if (controller.signal.aborted) return;
      lastError = error;
      if (error.status) break;
    }
  }
  if (controller.signal.aborted) return;
  const timeout = signal.aborted || ['TimeoutError', 'AbortError'].includes(lastError?.name);
  return res.status(timeout ? 504 : 502).json({ error: { code: timeout ? 'AI_TIMEOUT' : 'AI_DESIGN_FAILED', message: timeout ? '设计超时，当前排版已保留，请重试' : '新版式未通过完整性或适配检查，当前排版已保留，请重试' } });
});

app.post('/api/articles/edit', rateLimit(20, 'RATE_EDIT_PER_MIN'), concurrentGenerationLimit, async (req, res) => {
  if (!canWriteConfig(req)) return res.status(403).json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: '当前页面来源未被服务端允许' } });
  const parsed = AIEditRequestSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: { code: 'INVALID_EDIT_INPUT', message: '请提供有效文章和1–4000字的修改要求' } });
  const { article, prompt, references, messages, attachments, scope } = parsed.data;
  if (article.html && scope === 'selection' && !references.length) return res.status(400).json({ error: { code: 'INVALID_SELECTION', message: '请先选择需要修改的文字或图片，或切换到全文范围' } });
  if (new Set(article.blocks.map(block => block.id)).size !== article.blocks.length) return res.status(400).json({ error: { code: 'INVALID_CONTENT_REFS', message: '文章内容编号重复，请恢复草稿后重试' } });
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(AI_EDIT_TIMEOUT_MS)]);
  let config;
  try { config = await resolveAIConfig(); }
  catch (error) { return res.status(error.status || 502).json({ error: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || '无法连接 AI 服务' } }); }
  if (!config.baseUrl || !config.apiKey || !config.model) return res.status(400).json({ error: { code: 'AI_NOT_CONFIGURED', message: '请先在顶部设置中配置 AI 服务' } });
  const assetIds = [...new Set(article.blocks.filter(isImageBlock).map(block => block.assetId))];
  const imageDimensions = await Promise.all(assetIds.map(async assetId => {
    const filename = fs.readdirSync(uploadDir).find(name => name.startsWith(`${assetId}.`));
    try {
      const metadata = filename && await sharp(path.join(uploadDir, filename)).metadata();
      return { assetId, width: metadata?.width || null, height: metadata?.height || null };
    } catch { return { assetId, width: null, height: null }; }
  }));
  const imageAssetIds = [...new Set(attachments.flatMap(attachment => attachment.kind === 'image' ? [attachment.assetId] : attachment.imageAssetIds))];
  if (imageAssetIds.length > MAX_EDIT_IMAGES) return res.status(400).json({ error: { code: 'TOO_MANY_ATTACHMENT_IMAGES', message: `最多同时使用${MAX_EDIT_IMAGES}张附件图片` } });
  const imageInputs = [];
  let imageInputBytes = 0;
  for (const [index, imageAssetId] of imageAssetIds.entries()) {
    const filename = fs.readdirSync(uploadDir).find(name => name.startsWith(`${imageAssetId}.`));
    if (!filename) return res.status(400).json({ error: { code: 'ATTACHMENT_EXPIRED', message: '附件图片缓存已过期，请重新上传' } });
    const buffer = await fs.promises.readFile(path.join(uploadDir, filename));
    imageInputBytes += buffer.length;
    if (imageInputBytes > MAX_EDIT_IMAGE_BYTES) return res.status(413).json({ error: { code: 'ATTACHMENT_TOO_LARGE', message: '附件图片总大小不能超过20 MB' } });
    const mime = ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' })[path.extname(filename).toLowerCase()];
    if (!mime) return res.status(400).json({ error: { code: 'INVALID_ATTACHMENT_IMAGE', message: '附件图片格式无效，请重新上传' } });
    imageInputs.push({ name: attachments.flatMap(attachment => attachment.kind === 'image' ? [{ assetId: attachment.assetId, name: attachment.name }] : attachment.imageAssetIds.map((assetId, imageIndex) => ({ assetId, name: `${attachment.name} 图片 ${imageIndex + 1}` }))).find(item => item.assetId === imageAssetId)?.name || `附件图片 ${index + 1}`, mime, buffer });
  }
  const input = { template: templates.find(template => template.id === article.templateId), scope, article: { html: article.html, mode: article.mode, title: article.title, summary: article.summary, blocks: article.blocks, templateId: article.templateId, layoutDesign: article.layoutDesign, tone: article.settings.tone }, imageDimensions, ...(attachments.length ? { attachments } : {}), conversation: messages, prompt, references };
  if (JSON.stringify(input).length > 1_100_000) return res.status(400).json({ error: { code: 'CONTENT_TOO_LONG', message: '文章、附件文字或引用内容过长，请移除部分附件或减少引用后重试；正文不会被截断提交' } });
  const usages = res.locals.modelUsages = [];
  let lastError;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (signal.aborted) break;
    usages.push(normalizeUsage());
    try {
      const output = await requestModel({ config, system: article.html ? htmlEditInstructions : editInstructions, signal, inputData: { ...input, previousValidationError: lastError?.message.slice(0, 1200) }, imageInputs });
      usages[attempt] = output.usage;
      const result = AIEditResponseSchema.parse(JSON.parse(output.text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/, '$1')));
      const candidate = buildAIEdit(article, result.operations, { references, scope });
      renderArticle(candidate, templates.find(template => template.id === candidate.templateId));
      if (!controller.signal.aborted) return res.json({ ...result, changes: describeAIEdit(article, candidate), meta: { model: config.model, retried: attempt > 0, ...usageMeta(usages) } });
      return;
    } catch (error) {
      if (controller.signal.aborted) return;
      lastError = error;
      if (error.status) break;
    }
  }
  if (controller.signal.aborted) return;
  if (imageInputs.length && isUnsupportedVisionRequest(lastError)) return res.status(422).json({ error: { code: 'VISION_UNSUPPORTED', message: '当前模型不支持多模态识图' } });
  const timeout = signal.aborted || ['TimeoutError', 'AbortError'].includes(lastError?.name);
  const upstream = Boolean(lastError?.status);
  const code = timeout ? 'AI_TIMEOUT' : lastError?.upstreamCode === 'model_price_error' ? 'AI_UPSTREAM_CONFIG_ERROR' : upstream ? 'AI_UPSTREAM_ERROR' : 'AI_EDIT_FAILED';
  const message = timeout ? '修改方案生成超时，原稿已保留，请重试'
    : code === 'AI_UPSTREAM_CONFIG_ERROR' ? '当前模型的上游计费配置错误，请联系 AI 服务商修复或切换模型'
      : upstream ? `AI 服务请求失败（HTTP ${lastError.status}），请检查模型和服务配置`
        : '修改方案未通过内容或版式检查，原稿已保留，请重试';
  res.locals.modelFailure = { kind: timeout ? 'timeout' : upstream ? 'upstream' : 'validation', ...(lastError?.status ? { status: lastError.status } : {}), ...(lastError?.upstreamCode ? { upstreamCode: lastError.upstreamCode } : {}) };
  return res.status(timeout ? 504 : 502).json({ error: { code, message } });
});

app.use(express.static(path.join(root, 'dist')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
  const tooMany = error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE';
  const status = tooLarge ? 413 : error instanceof multer.MulterError ? 400 : 500;
  const code = tooLarge ? 'FILE_TOO_LARGE' : tooMany ? 'TOO_MANY_FILES' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_UPLOAD';
  const message = tooLarge ? '文件超过大小限制' : tooMany ? '每次最多解析 5 个文件' : status === 500 ? '服务暂时不可用' : '上传内容无效';
  res.status(status).json({ error: { code, message } });
});
app.use((req, res) => {
  if (req.method === 'GET' && fs.existsSync(path.join(root, 'dist', 'index.html'))) return res.sendFile(path.join(root, 'dist', 'index.html'));
  res.status(404).json({ error: { code: 'NOT_FOUND', message: '接口不存在' } });
});

const cleanupExpiredAssets = () => {
  const lifetime = Number(process.env.ASSET_TTL_DAYS || 7) * 86_400_000;
  for (const name of fs.readdirSync(uploadDir)) {
    const filename = path.join(uploadDir, name);
    try { if (Date.now() - fs.statSync(filename).mtimeMs > lifetime) fs.rmSync(filename, { force: true }); } catch { /* removed by another request */ }
  }
};
cleanupExpiredAssets();
setInterval(cleanupExpiredAssets, 24 * 60 * 60 * 1000).unref();
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`wechat-ai server listening on ${port}`));
