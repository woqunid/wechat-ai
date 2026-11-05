import { blockText } from './core.js';

export const CREATION_MODES = {
  create: { label: '素材创作', hint: '根据主题和素材组织文章，可重组结构，不编造事实' },
  polish: { label: '素材润色', hint: '保留事实、重要细节和叙事顺序，优化表达' },
  raw: { label: '原文排版', hint: '不调用 AI，忽略主题、语气和长度，只识别原文结构' }
};
export const WRITING_TONES = {
  formal: { label: '正式', hint: '客观克制、用词准确，避免口号和夸张表达' },
  plain: { label: '通俗', hint: '日常用词、短句为主，必要术语用已有信息解释' },
  lively: { label: '活泼', hint: '轻快自然、有交流感，避免夸张、卖萌和标题党' }
};
export const TARGET_LENGTHS = [600, 1000, 1500, 2000];
export const GENERATION_TIMEOUT_MS = 180_000;

export const bodyText = blocks => blocks.filter(block => !['image', 'imageCard', 'divider'].includes(block.type))
  .map(block => blockText(block) + (block.type === 'quote' && block.cite ? `\n${block.cite}` : '')).join('\n');
export const countCharacters = text => Array.from(text.replace(/\s/g, '')).length;
export const bodyCharCount = blocks => countCharacters(bodyText(blocks));
export function bodyLengthStatus(blocks, targetLength) {
  const actual = bodyCharCount(blocks);
  const min = Math.ceil(targetLength * 0.85);
  const max = Math.floor(targetLength * 1.15);
  return { actual, target: targetLength, min, max, within: actual >= min && actual <= max };
}
