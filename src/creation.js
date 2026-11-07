import { blockText, TARGET_LENGTH_MAX, TARGET_LENGTH_MIN } from './core.js';

export { TARGET_LENGTH_MAX, TARGET_LENGTH_MIN };

export const CREATION_MODES = {
  create: { label: '创作', hint: '从主题或素材生成文章' },
  polish: { label: '润色', hint: '保留原意，优化表达' },
  raw: { label: '排版', hint: '保留原文，无需 AI' }
};
export const WRITING_TONES = {
  formal: { label: '正式', hint: '客观克制、用词准确，避免口号和夸张表达' },
  plain: { label: '通俗', hint: '日常用词、短句为主，必要术语用已有信息解释' },
  lively: { label: '活泼', hint: '轻快自然、有交流感，避免夸张、卖萌和标题党' }
};
export const TARGET_LENGTHS = [600, 1000, 1500, 2000];
export const validTargetLength = value => Number.isInteger(value) && value >= TARGET_LENGTH_MIN && value <= TARGET_LENGTH_MAX;
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
export const lengthNotice = length => length && !length.within ? `正文 ${length.actual} 字，${length.actual < length.min ? '少于' : '超过'}目标范围 ${length.min}–${length.max} 字，可用 AI 修改调整` : '';
