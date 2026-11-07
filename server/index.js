import express from 'express';
import multer from 'multer';
import mammoth from 'mammoth';
import sharp from 'sharp';
import crypto from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { ArticleSchema, blockText, uid } from '../src/core.js';
import { templates } from '../src/templates.js';
import { normalizeDraft } from '../src/content.js';
import { GENERATION_TIMEOUT_MS, TARGET_LENGTHS, WRITING_TONES } from '../src/creation.js';
import { generationInstructions, inspectDraft, preferDraft, protectedFragments } from './writing-rules.js';
import { recommendTemplates } from '../src/recommender.js';
import { fetchModels, getAIConfig, getAIStatus, resolveAIConfig, resolveCredentials, safeAIStatus } from './ai-config.js';
import { fetchRemoteImage, MAX_IMAGE_BYTES } from './remote-image.js';
import { cleanupExpiredAssets, findImageFiles, imageDateDirectory, imageLifetime } from './image-storage.js';
import { clearArticleStyles, layoutSource, LAYOUT_TIMEOUT_MS, validateLayoutDesign } from '../src/layout-design.js';
import { renderArticle } from '../src/renderer.js';
import { layoutInstructions } from './layout-rules.js';
import { AIEditRequestSchema, AIEditResponseSchema, AI_EDIT_TIMEOUT_MS, aiEditConversation, buildAIEdit, describeAIEdit, isImageBlock } from '../src/ai-edit.js';
import { unsupportedStyles } from '../src/html-document.js';
import { editInstructions } from './edit-rules.js';
import { htmlEditInstructions } from './html-edit-rules.js';
import { usageMeta } from './ai-usage.js';
import { allowedOrigins, concurrentGenerationLimit, configError, rateLimit, requireOrigin, sendError } from './http.js';
import { blocksFromDocxHtml, decodeText, isDocx, isPdf, MAX_EDIT_IMAGE_BYTES, MAX_EDIT_IMAGES, parsePdfAttachment, parsePdfText, waitFor } from './documents.js';
import { isUnsupportedVisionRequest, parseModelJson, runModelTask } from './model-client.js';
import { registerAdminRoutes } from './admin-routes.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env') });
const uploadDir = process.env.ASSET_DIR ? path.resolve(process.env.ASSET_DIR) : path.join(root, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });
const app = express();
app.set('trust proxy', 'loopback');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const MAX_EDIT_DOCUMENT_CHARS = 200_000;
const IMAGE_MIME = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
let activeImageImports = 0;

app.use(express.json({ limit: '4mb' }));
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins().includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
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

const publicAssetUrl = filename => `${String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/$/, '')}/uploads/${filename}`;
const imageAssetExists = id => findImageFiles(uploadDir, id).length > 0;
const attachmentName = file => path.basename(file.originalname).slice(0, 240);

app.get('/api/health', (req, res) => res.json({ status: 'ok', version: '0.1.0' }));
registerAdminRoutes(app, { envPath: path.join(root, '.env') });
app.get('/api/config/status', async (req, res) => {
  let config;
  try { config = getAIConfig(); } catch { return res.json(safeAIStatus()); }
  if (config.baseUrl && config.apiKey && !config.model) {
    try { await resolveAIConfig(); }
    catch (error) { return res.json({ ...getAIStatus(), configurationError: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || '无法获取模型列表' } }); }
  }
  const status = getAIStatus();
  const partial = status.source !== 'none' && !(status.baseUrl && status.hasApiKey && status.model);
  res.json({ ...status, ...(partial ? { configurationError: { code: 'AI_CONFIG_INCOMPLETE', message: 'AI 服务配置不完整，请填写服务 URL、API Key 并选择模型' } } : {}) });
});
app.post('/api/config/models', rateLimit(20, 'RATE_CONFIG_PER_MIN'), requireOrigin('当前页面来源未被服务端允许，请配置 ALLOWED_ORIGIN 或检查反向代理来源信息'), async (req, res) => {
  try {
    const credentials = resolveCredentials(req.body);
    const models = await fetchModels(credentials);
    res.json({ baseUrl: credentials.baseUrl, models });
  } catch (error) { configError(res, error); }
});
app.get('/api/templates', (req, res) => res.json({ version: '2.1.0', templates }));

app.post('/api/materials/parse', rateLimit(20, 'RATE_PARSE_PER_MIN'), upload.array('files', 5), async (req, res) => {
  const files = [];
  for (const file of req.files || []) {
    const name = attachmentName(file);
    try {
      const extension = path.extname(file.originalname).toLowerCase();
      const buffer = file.buffer;
      let text = '';
      let blocks;
      let imageCount = 0;
      if (extension === '.txt' || extension === '.md') {
        text = decodeText(buffer);
      } else if (extension === '.docx' && isDocx(buffer)) {
        const structured = blocksFromDocxHtml((await waitFor(mammoth.convertToHtml({ buffer }))).value);
        blocks = structured.blocks;
        text = structured.text;
        imageCount = structured.ignoredImages;
      } else if (extension === '.pdf' && isPdf(buffer)) {
        text = await parsePdfText(buffer);
      } else {
        throw new Error('unsupported type or signature');
      }
      const withoutWhitespace = text.replace(/\s/g, '');
      const badChars = (text.match(/[\uFFFD\u0000-\u0008\u000b\u000c\u000e-\u001f]/g) || []).length;
      if (withoutWhitespace.length < 20 || badChars / Math.max(text.length, 1) > 0.05) throw new Error('extraction quality too low');
      files.push({ name, ok: true, text, charCount: text.length, preview: text.slice(0, 200), ...(blocks ? { blocks } : {}), ...(imageCount ? { warnings: ['文档中的图片未导入，请单独上传'], imageCount } : {}) });
    } catch {
      files.push({ name, ok: false, error: '无法读取文本，请粘贴文字' });
    }
  }
  res.json({ files });
});

app.post('/api/articles/edit/attachments', rateLimit(60, 'RATE_EDIT_ATTACHMENTS_PER_MIN'), upload.single('file'), requireOrigin(), async (req, res) => {
  const file = req.file;
  if (!file) return sendError(res, 400, 'INVALID_ATTACHMENT', '请选择图片或文档');
  const name = attachmentName(file);
  const extension = path.extname(name).toLowerCase();
  if (Object.hasOwn(IMAGE_MIME, extension)) {
    if (file.size > MAX_IMAGE_BYTES) return sendError(res, 413, 'FILE_TOO_LARGE', '图片不能超过10 MB');
    try {
      const asset = await cacheImage(file.buffer);
      return res.json({ attachment: { kind: 'image', name, assetId: asset.id, cacheUrl: asset.cacheUrl, url: asset.url, mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height, expiresAt: asset.expiresAt } });
    } catch (error) {
      return sendError(res, 400, error.code || 'INVALID_IMAGE', error.message || '图片无法处理');
    }
  }
  if (!['.pdf', '.docx', '.txt', '.md'].includes(extension)) return sendError(res, 400, 'UNSUPPORTED_ATTACHMENT', '仅支持 JPG、PNG、WebP、PDF、DOCX、TXT 和 MD');

  let text = '';
  let imageBuffers = [];
  let omittedImages = 0;
  try {
    if (extension === '.txt' || extension === '.md') {
      text = decodeText(file.buffer);
    } else if (extension === '.docx' && isDocx(file.buffer)) {
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
      }));
      text = blocksFromDocxHtml(converted.value).text;
    } else if (extension === '.pdf' && isPdf(file.buffer)) {
      const parsed = await parsePdfAttachment(file.buffer);
      text = parsed.text;
      imageBuffers = parsed.images;
      omittedImages = parsed.omittedImages;
    } else {
      return sendError(res, 400, 'UNREADABLE_DOCUMENT', '文档无法读取');
    }
    const extractedTextLength = text.replace(/\s/g, '').length;
    if (!text.trim() && !imageBuffers.length) return sendError(res, 422, 'UNREADABLE_DOCUMENT', '文档中没有可用文字或图片');
    if (extension === '.pdf' && extractedTextLength < 20) return sendError(res, 422, 'UNREADABLE_DOCUMENT', '未提取到足够的文字，不支持扫描版 PDF 或图片文字识别');
    if (text.length > MAX_EDIT_DOCUMENT_CHARS) return sendError(res, 413, 'DOCUMENT_TOO_LARGE', '文档文字超过20万字，请拆分后上传');
    const images = [];
    let imageBytes = 0;
    for (const [index, imageBuffer] of imageBuffers.entries()) {
      if (imageBytes + imageBuffer.length > MAX_EDIT_IMAGE_BYTES) { omittedImages++; continue; }
      try {
        const asset = await cacheImage(imageBuffer);
        imageBytes += asset.bytes;
        images.push({ assetId: asset.id, name: `${name} 图片 ${index + 1}`, cacheUrl: asset.cacheUrl, url: asset.url, mime: asset.mime, bytes: asset.bytes, width: asset.width, height: asset.height, expiresAt: asset.expiresAt });
      } catch { omittedImages++; }
    }
    return res.json({ attachment: { kind: 'document', name, text, charCount: text.length, images, ...(omittedImages ? { warning: `有${omittedImages}张内嵌图片无法提取或超过附件上限` } : {}) } });
  } catch {
    return sendError(res, 422, 'UNREADABLE_DOCUMENT', '文档无法读取，请确认文件完整；扫描版 PDF 不支持识别');
  }
});

const imageError = (code, message) => Object.assign(new Error(message), { code, status: 400 });
async function cacheImage(buffer, sourceUrl) {
  if (!buffer.length || buffer.length > MAX_IMAGE_BYTES) throw imageError('IMAGE_TOO_LARGE', '图片为空或超过 10MB');
  const metadata = await sharp(buffer, { failOn: 'error' }).metadata();
  const format = { jpeg: { mime: 'image/jpeg', extension: 'jpg' }, png: { mime: 'image/png', extension: 'png' }, webp: { mime: 'image/webp', extension: 'webp' } }[metadata.format];
  if (!format) throw imageError('INVALID_IMAGE', '仅支持 JPG、PNG 和 WebP 图片');
  if (!metadata.width || !metadata.height || metadata.width > 8000 || metadata.height > 8000) throw imageError('DIMENSION_EXCEEDED', '图片尺寸过大');
  const id = uid('img');
  const filename = `${id}.${format.extension}`;
  const normalized = await sharp(buffer).rotate().toBuffer({ resolveWithObject: true });
  if (normalized.info.size > MAX_IMAGE_BYTES) throw imageError('IMAGE_TOO_LARGE', '图片处理后超过 10MB');
  const uploadedAt = Date.now();
  const directory = imageDateDirectory(uploadedAt);
  const relativePath = `${directory}/${filename}`;
  await fs.promises.mkdir(path.join(uploadDir, directory), { recursive: true });
  await fs.promises.writeFile(path.join(uploadDir, relativePath), normalized.data);
  const cacheUrl = `/uploads/${relativePath}`;
  const publicUrl = publicAssetUrl(relativePath);
  return { id, filename, mime: format.mime, width: normalized.info.width, height: normalized.info.height, bytes: normalized.info.size, cacheUrl, url: sourceUrl && !/^https:\/\//i.test(publicUrl) ? sourceUrl : publicUrl, ...(sourceUrl ? { sourceUrl } : {}), expiresAt: new Date(uploadedAt + imageLifetime()).toISOString(), pasteStatus: 'needs-manual' };
}

app.post('/api/assets/import', rateLimit(20, 'RATE_IMPORT_PER_MIN'), requireOrigin('此来源不能导入图片'), async (req, res) => {
  if (activeImageImports >= 2) return sendError(res, 429, 'RATE_LIMITED', '正在读取其他图片，请稍后重试');
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  activeImageImports++;
  try {
    const { buffer, sourceUrl } = await fetchRemoteImage(req.body?.url, controller.signal);
    const asset = await cacheImage(buffer, sourceUrl);
    if (!controller.signal.aborted) res.json({ asset });
  } catch (error) {
    if (!controller.signal.aborted) sendError(res, error.status || 400, error.code || 'INVALID_IMAGE', error.status ? error.message : '图片无法处理，请使用 JPG、PNG 或 WebP 直链');
  } finally { activeImageImports--; }
});

app.post('/api/assets', rateLimit(60, 'RATE_ASSETS_PER_MIN'), upload.single('file'), async (req, res) => {
  try {
    const imageExtension = req.file ? path.extname(req.file.originalname).toLowerCase() : '';
    if (!req.file || req.file.size > MAX_IMAGE_BYTES || !Object.hasOwn(IMAGE_MIME, imageExtension)) {
      return sendError(res, 400, req.file?.size > MAX_IMAGE_BYTES ? 'IMAGE_TOO_LARGE' : 'INVALID_IMAGE', '图片格式不支持或超过 10MB');
    }
    res.json({ asset: await cacheImage(req.file.buffer) });
  } catch (error) {
    sendError(res, error.status || 400, error.code || 'INVALID_IMAGE', error.status ? error.message : '图片无法处理');
  }
});

app.delete('/api/assets/:id', (req, res) => {
  const id = req.params.id;
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return sendError(res, 400, 'INVALID_ID', '资源编号无效');
  const matches = findImageFiles(uploadDir, id);
  if (!matches.length) return sendError(res, 404, 'NOT_FOUND', '图片资源不存在');
  for (const name of matches) fs.rmSync(path.join(uploadDir, name), { force: true });
  res.status(204).end();
});

app.post('/api/articles/generate', rateLimit(10, 'RATE_GENERATE_PER_MIN'), concurrentGenerationLimit, async (req, res) => {
  const { mode = 'create', topic = '', text = '', materials = [], tone = 'plain', targetLength = 1000, assetIds = [], templateId } = req.body || {};
  if (!['create', 'polish'].includes(mode)) return sendError(res, 400, 'INVALID_MODE', '创作方式无效');
  if (typeof topic !== 'string' || typeof text !== 'string' || !Array.isArray(materials) || materials.some(value => typeof value !== 'string') || !Array.isArray(assetIds) || assetIds.length > 10) return sendError(res, 400, 'INVALID_INPUT', '输入内容格式无效');
  if (typeof tone !== 'string' || !Object.hasOwn(WRITING_TONES, tone) || !TARGET_LENGTHS.includes(targetLength)) return sendError(res, 400, 'INVALID_SETTINGS', '文章设置无效');
  const template = templateId === undefined ? undefined : templates.find(item => item.id === templateId);
  if (templateId !== undefined && !template) return sendError(res, 400, 'INVALID_TEMPLATE', '模板不存在');
  const source = [text, ...materials].filter(Boolean).join('\n\n');
  if (source.length > 30_000) return sendError(res, 400, 'INPUT_TOO_LONG', '素材总量超过 30,000 字');
  if (mode === 'polish' && !source.trim()) return sendError(res, 400, 'INPUT_EMPTY', '请先添加正文或文档素材');
  if (mode === 'create' && !topic.trim() && !source.trim()) return sendError(res, 400, 'INPUT_EMPTY', '请输入主题或上传/粘贴素材');
  if (mode === 'create' && !source.trim() && topic.trim().length < 5) return sendError(res, 400, 'TOPIC_TOO_SHORT', '主题至少 5 个字符');
  if (new Set(assetIds).size !== assetIds.length || assetIds.some(id => !imageAssetExists(id))) return sendError(res, 400, 'INVALID_ASSET', '部分图片已失效，请重新上传');
  const title = (topic.trim() || source.trim().split(/\n/)[0] || '未命名文章').slice(0, 64);
  const startedAt = Date.now();
  const templateContentGuide = template ? { preferredBlocks: template.fit.preferredBlocks, headingLevels: [1, 2], missingContent: 'omit', priority: 'below-writing-rules' } : undefined;
  const protectedParts = mode === 'polish' ? protectedFragments(source) : [];
  let draft = null;
  let report;
  const respond = meta => {
    const now = new Date().toISOString();
    const parsed = ArticleSchema.safeParse({
      schemaVersion: 1, id: uid('article'), mode, title: String(draft.title || title).slice(0, 64),
      summary: draft.summary, blocks: draft.blocks, templateId: templateId || 'T01',
      settings: { tone, targetLength, aiGenerated: true },
      createdAt: now, updatedAt: now
    });
    if (!parsed.success) return sendError(res, 502, 'AI_INVALID_OUTPUT', '生成内容格式异常，请重试');
    const referenced = new Set(parsed.data.blocks.filter(isImageBlock).map(block => block.assetId));
    for (const assetId of assetIds) if (!referenced.has(assetId)) {
      parsed.data.blocks.push({ id: uid('b'), type: 'imageCard', assetId, caption: '' });
    }
    if (!templateId) parsed.data.templateId = recommendTemplates(parsed.data)[0]?.id || 'T01';
    res.json({ article: parsed.data, meta: { promptVersion: 'semantic-3', schemaVersion: 1, ...meta({ latencyMs: Date.now() - startedAt }), ...(report ? { length: report.length, protectedMissingCount: report.missing.length } : {}) } });
  };
  await runModelTask(req, res, {
    timeoutMs: GENERATION_TIMEOUT_MS,
    failure: { code: 'AI_INVALID_OUTPUT', message: '生成暂时未完成，请重试' },
    async attempt({ lastError, request }) {
      const output = await request({
        system: generationInstructions({ mode, tone, targetLength }),
        inputData: { task: mode === 'polish' ? '润色文章，保留事实与重要细节及叙事顺序' : '基于主题和素材创作文章', mode, topic, source, imageAssetIds: assetIds, tone, targetLength, templateContentGuide, revision: draft ? { draft, issues: report.issues, actualBodyChars: report.length.actual } : undefined, schemaVersion: 1, previousValidationError: lastError?.message || undefined },
      });
      const next = normalizeDraft(output, assetIds);
      const nextReport = inspectDraft(next, { targetLength, protectedParts });
      if (preferDraft(nextReport, report)) { draft = next; report = nextReport; }
      if (!report.issues.length) return respond;
    },
    fallback: () => draft && respond,
  });
});

app.post('/api/articles/design', rateLimit(10, 'RATE_DESIGN_PER_MIN'), concurrentGenerationLimit, requireOrigin(), async (req, res) => {
  const { mode, prompt = '' } = req.body || {};
  const parsed = ArticleSchema.pick({ title: true, summary: true, blocks: true }).safeParse(req.body?.article);
  if (!parsed.success || !['auto', 'prompt'].includes(mode) || typeof prompt !== 'string' || prompt.length > 1000 || (mode === 'prompt' && !prompt.trim())) return sendError(res, 400, 'INVALID_DESIGN_INPUT', '请提供有效文章、设计方式和不超过1000字的风格要求');
  const article = parsed.data;
  const content = layoutSource(article);
  if (!content.some(item => item.text?.trim() || item.items?.some(text => text.trim()))) return sendError(res, 400, 'CONTENT_EMPTY', '请先添加文章内容');
  if (new Set(content.map(item => item.ref)).size !== content.length) return sendError(res, 400, 'INVALID_CONTENT_REFS', '文章内容编号重复，请恢复草稿后重试');
  if (JSON.stringify(content).length > 180_000) return sendError(res, 400, 'CONTENT_TOO_LONG', '文章过长，请分篇后设计；全文不会被截断提交');
  await runModelTask(req, res, {
    timeoutMs: LAYOUT_TIMEOUT_MS,
    failure: { code: 'AI_DESIGN_FAILED', message: '新版式未通过完整性或适配检查，当前排版已保留，请重试', timeoutMessage: '设计超时，当前排版已保留，请重试' },
    async attempt({ lastError, request }) {
      const output = await request({ system: layoutInstructions, inputData: { mode, designPrompt: mode === 'prompt' ? prompt.trim() : undefined, content, previousValidationError: lastError?.message.slice(0, 800) } });
      const design = validateLayoutDesign(parseModelJson(output), article);
      renderArticle({ ...clearArticleStyles(article), layoutDesign: design }, templates[0]);
      return meta => res.json({ design, meta: meta() });
    },
  });
});

const listStyles = (styles, count = 6) => styles.slice(0, count).map(style => style.slice(0, 120)).join('、');
app.post('/api/articles/edit', rateLimit(20, 'RATE_EDIT_PER_MIN'), concurrentGenerationLimit, requireOrigin(), async (req, res) => {
  const parsed = AIEditRequestSchema.safeParse(req.body);
  if (!parsed.success) return sendError(res, 400, 'INVALID_EDIT_INPUT', '请提供有效文章和1–4000字的修改要求');
  const { article, prompt, references, messages, attachments, pendingChanges, layoutRepair } = parsed.data;
  if (new Set(article.blocks.map(block => block.id)).size !== article.blocks.length) return sendError(res, 400, 'INVALID_CONTENT_REFS', '文章内容编号重复，请恢复草稿后重试');
  const assetIds = [...new Set(article.blocks.filter(isImageBlock).map(block => block.assetId))];
  const dimensions = assetIds => Promise.all(assetIds.map(async assetId => {
    const filename = findImageFiles(uploadDir, assetId)[0];
    try {
      const metadata = filename && await sharp(path.join(uploadDir, filename)).metadata();
      return { assetId, width: metadata?.width || null, height: metadata?.height || null };
    } catch { return { assetId, width: null, height: null }; }
  }));
  const imageDimensions = await dimensions(assetIds);
  const attachmentImages = attachments.flatMap(attachment => attachment.kind === 'image' ? [{ assetId: attachment.assetId, name: attachment.name }] : attachment.imageAssetIds.map((assetId, imageIndex) => ({ assetId, name: `${attachment.name} 图片 ${imageIndex + 1}` })));
  const imageAssetIds = [...new Set(attachmentImages.map(image => image.assetId))];
  if (imageAssetIds.length > MAX_EDIT_IMAGES) return sendError(res, 400, 'TOO_MANY_ATTACHMENT_IMAGES', `最多同时使用${MAX_EDIT_IMAGES}张附件图片`);
  const imageInputs = [];
  let imageInputBytes = 0;
  for (const [index, imageAssetId] of imageAssetIds.entries()) {
    const filename = findImageFiles(uploadDir, imageAssetId)[0];
    if (!filename) return sendError(res, 400, 'ATTACHMENT_EXPIRED', '附件图片缓存已过期，请重新上传');
    const buffer = await fs.promises.readFile(path.join(uploadDir, filename));
    imageInputBytes += buffer.length;
    if (imageInputBytes > MAX_EDIT_IMAGE_BYTES) return sendError(res, 413, 'ATTACHMENT_TOO_LARGE', '附件图片总大小不能超过20 MB');
    const mime = IMAGE_MIME[path.extname(filename).toLowerCase()];
    if (!mime) return sendError(res, 400, 'INVALID_ATTACHMENT_IMAGE', '附件图片格式无效，请重新上传');
    const name = attachmentImages.find(item => item.assetId === imageAssetId)?.name || `附件图片 ${index + 1}`;
    imageInputs.push({ assetId: imageAssetId, name, label: `附件图片：${name}（assetId：${imageAssetId}）`, mime, buffer });
  }
  const referencedImages = [...new Map(references.filter(reference => reference.kind === 'image' && assetIds.includes(reference.assetId)).map(reference => [reference.assetId, reference])).values()];
  const referenceInputs = (await Promise.all(referencedImages.map(async ({ assetId, text }) => {
    const filename = findImageFiles(uploadDir, assetId)[0];
    if (!filename) return [];
    try {
      const buffer = await sharp(path.join(uploadDir, filename)).resize({ width: 1280, height: 1280, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
      return [{ assetId, label: `引用图片：${text.slice(0, 60)}（assetId：${assetId}）`, mime: 'image/jpeg', buffer }];
    } catch { return []; }
  }))).flat();
  const visionInputs = [...imageInputs, ...referenceInputs];
  const insertableImages = (await dimensions(imageAssetIds)).map(item => ({ ...item, name: imageInputs.find(image => image.assetId === item.assetId).name }));
  const outline = block => ({ id: block.id, type: block.type, text: blockText(block).slice(0, 40), ...(isImageBlock(block) ? { assetId: block.assetId } : {}) });
  const content = article.html ? { html: article.html, blocks: article.blocks.map(outline) } : { blocks: article.blocks, layoutDesign: article.layoutDesign };
  const input = { template: templates.find(template => template.id === article.templateId), article: { mode: article.mode, title: article.title, summary: article.summary, templateId: article.templateId, tone: article.settings.tone, ...content }, imageDimensions, ...(referenceInputs.length ? { visibleReferenceImages: referenceInputs.map(image => image.assetId) } : {}), ...(attachments.length ? { attachments } : {}), ...(insertableImages.length ? { insertableImages } : {}), conversation: aiEditConversation(messages), prompt, references, pendingChanges, ...(layoutRepair ? { layoutRepair } : {}) };
  if (JSON.stringify(input).length > 1_100_000) return sendError(res, 400, 'CONTENT_TOO_LONG', '文章、附件文字或引用内容过长，请移除部分附件或减少引用后重试；正文不会被截断提交');
  let fallback;
  const respond = ({ result, candidate, ignored }) => meta => {
    const note = ignored.length ? `\n已忽略公众号不支持的样式：${listStyles(ignored)}${ignored.length > 6 ? ' 等' : ''}` : '';
    res.json({ ...result, message: result.message.slice(0, 4000 - note.length) + note, changes: describeAIEdit(article, candidate), meta: meta() });
  };
  await runModelTask(req, res, {
    timeoutMs: AI_EDIT_TIMEOUT_MS,
    failure: { code: 'AI_EDIT_FAILED', message: '修改方案未通过内容或版式检查，原稿已保留，请重试', timeoutMessage: '修改方案生成超时，原稿已保留，请重试' },
    async attempt({ attempt, lastError, request }) {
      const output = await request({ system: article.html ? htmlEditInstructions : editInstructions, inputData: { ...input, previousValidationError: lastError?.message.slice(0, 1200) }, imageInputs: visionInputs });
      const result = AIEditResponseSchema.parse(parseModelJson(output));
      const ignored = [...new Set(result.operations.flatMap(op => op.html ? unsupportedStyles(op.html) : []))];
      let candidate;
      try { candidate = buildAIEdit(article, result.operations, { references, assetIds: imageAssetIds }); }
      catch (error) {
        if (ignored.length) throw new Error(`${error.message}；不支持的样式：${listStyles(ignored)}`);
        throw error;
      }
      renderArticle(candidate, templates.find(template => template.id === candidate.templateId));
      if (ignored.length && !attempt) {
        fallback = { result, candidate, ignored };
        throw new Error(`方案使用了公众号不支持的样式（${ignored.slice(0, 8).join('；')}），这些样式会被移除；请改用单列流式排版中最接近的合规写法，并在 message 中说明`);
      }
      return respond({ result, candidate, ignored });
    },
    fallback: lastError => {
      if (fallback) return respond(fallback);
      if (visionInputs.length && isUnsupportedVisionRequest(lastError)) return () => sendError(res, 422, 'VISION_UNSUPPORTED', '当前模型不支持多模态识图');
    },
  });
});

app.use(express.static(path.join(root, 'dist')));
app.use((error, req, res, next) => {
  if (res.headersSent) return next(error);
  const tooLarge = error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE';
  const tooMany = error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE';
  const status = tooLarge ? 413 : error instanceof multer.MulterError ? 400 : 500;
  const code = tooLarge ? 'FILE_TOO_LARGE' : tooMany ? 'TOO_MANY_FILES' : status === 500 ? 'INTERNAL_ERROR' : 'INVALID_UPLOAD';
  const message = tooLarge ? '文件超过大小限制' : tooMany ? '每次最多解析 5 个文件' : status === 500 ? '服务暂时不可用' : '上传内容无效';
  sendError(res, status, code, message);
});
app.use((req, res) => {
  if (req.method === 'GET' && fs.existsSync(path.join(root, 'dist', 'index.html'))) return res.sendFile(path.join(root, 'dist', 'index.html'));
  sendError(res, 404, 'NOT_FOUND', '接口不存在');
});

cleanupExpiredAssets(uploadDir);
setInterval(() => cleanupExpiredAssets(uploadDir), 24 * 60 * 60 * 1000).unref();
const port = Number(process.env.PORT || 8787);
app.listen(port, () => console.log(`wechat-ai server listening on ${port}`));
