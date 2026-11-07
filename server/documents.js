import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import pdfjs from 'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js';
import sharp from 'sharp';
import crypto from 'node:crypto';
import { DomUtils, parseDocument } from 'htmlparser2';
import { uid } from '../src/core.js';

export const MAX_EDIT_IMAGES = 10;
export const MAX_EDIT_IMAGE_BYTES = 20 * 1024 * 1024;
export const PARSE_TIMEOUT_MS = 15_000;

export const waitFor = (promise, ms = PARSE_TIMEOUT_MS) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('parse timeout')), ms))]);
export const isDocx = buffer => buffer[0] === 0x50 && buffer[1] === 0x4b;
export const isPdf = buffer => buffer.subarray(0, 5).toString() === '%PDF-';
export function decodeText(buffer) {
  const text = new TextDecoder('utf-8').decode(buffer);
  return text.includes('\uFFFD') ? new TextDecoder('gbk').decode(buffer) : text;
}

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

export function blocksFromDocxHtml(html) {
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

export async function parsePdfText(buffer) {
  const parsed = await waitFor(pdfParse(buffer, { max: 200 }));
  if (parsed.numpages > 200) throw new Error('page limit');
  return parsed.text;
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

export async function parsePdfAttachment(buffer) {
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
    }));
    if (parsed.numpages > 200) throw new Error('page limit');
    return { text: parsed.text, images, omittedImages };
  } finally { if (!originalImage) delete globalThis.Image; }
}
