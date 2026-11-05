import { uid } from './core';

const asRuns = text => {
  const runs = [];
  const pattern = /\*\*(.+?)\*\*/g;
  let start = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > start) runs.push({ text: text.slice(start, match.index) });
    runs.push({ text: match[1], bold: true });
    start = pattern.lastIndex;
  }
  if (start < text.length) runs.push({ text: text.slice(start) });
  return runs.filter(run => run.text);
};

export const plain = value => String(value)
  .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
  .replace(/^#{1,6}\s*/gm, '')
  .replace(/^\s*(?:[-*+•]\s|\d+\.\s|>\s?|---\s*$)/gm, '')
  .replace(/\*\*|__|`/g, '')
  .replace(/\s/g, '');

export function checkRawConsistency(source, title, blocks) {
  const normalizedSource = plain(source);
  const parsedText = plain([title, ...blocks.map(block => {
    if (block.type === 'heading') return block.text;
    if (block.type === 'paragraph' || block.type === 'quote') return block.runs.map(run => run.text).join('');
    if (block.type === 'list') return block.items.map(item => item.map(run => run.text).join('')).join('');
    return '';
  })].join(''));
  let position = 0;
  while (position < Math.min(normalizedSource.length, parsedText.length) && normalizedSource[position] === parsedText[position]) position++;
  return {
    mismatch: normalizedSource !== parsedText,
    difference: {
      position,
      source: normalizedSource.slice(Math.max(0, position - 20), position + 20),
      parsed: parsedText.slice(Math.max(0, position - 20), position + 20)
    }
  };
}

export function parseRaw(source) {
  const lines = String(source || '').replace(/\r/g, '').split('\n');
  let title = '';
  let ignoredImages = 0;
  const blocks = [];
  let paragraph = [];
  let list = [];
  const flushParagraph = () => {
    if (paragraph.length) blocks.push({ id: uid('b'), type: 'paragraph', runs: asRuns(paragraph.join('\n').trim()) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length) blocks.push({ id: uid('b'), type: 'list', ordered: list[0].ordered, items: list.map(item => asRuns(item.text)) });
    list = [];
  };
  const heading = (text, level = 2) => blocks.push({ id: uid('b'), type: 'heading', level, text });

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const value = line.trim();
    if (!value) { flushParagraph(); flushList(); continue; }
    if (/^!\[[^\]]*\]\([^)]*\)$/.test(value)) { ignoredImages++; continue; }
    if (i === 0 && /^#\s/.test(value)) {
      const headingText = value.replace(/^#\s/, '');
      title = headingText.slice(0, 64);
      if (headingText.length > 64) blocks.push({ id: uid('b'), type: 'paragraph', runs: asRuns(headingText.slice(64)) });
      continue;
    }
    if (i === 0 && value.length <= 30 && !/[。！？；，.!?;,]$/.test(value) && !/^#{1,6}\s/.test(value)) { title = value; continue; }
    const markdownHeading = value.match(/^(#{1,6})\s+(.*)$/);
    if (markdownHeading) {
      flushParagraph(); flushList();
      if (markdownHeading[2].length <= 40) heading(markdownHeading[2], markdownHeading[1].length <= 2 ? 1 : 2);
      else blocks.push({ id: uid('b'), type: 'paragraph', runs: asRuns(markdownHeading[2]) });
      continue;
    }
    if (/^---+$/.test(value)) { flushParagraph(); flushList(); blocks.push({ id: uid('b'), type: 'divider' }); continue; }
    if (/^>\s?/.test(value)) {
      flushParagraph(); flushList();
      const runs = asRuns(value.replace(/^>\s?/, ''));
      if (runs.length) blocks.push({ id: uid('b'), type: 'quote', runs });
      continue;
    }
    const item = value.match(/^([-*+•]|\d+\.)\s+(.+)$/);
    if (item) { flushParagraph(); list.push({ ordered: /^\d/.test(item[1]), text: item[2] }); continue; }
    flushList();
    if (value.length <= 25 && !/[。！？；，.!?;,]$/.test(value) && i > 0) {
      flushParagraph(); heading(value, 2); continue;
    }
    paragraph.push(line);
  }
  flushParagraph();
  flushList();
  if (!blocks.length && source.trim()) blocks.push({ id: uid('b'), type: 'paragraph', runs: [{ text: source.trim() }] });

  const consistency = checkRawConsistency(source, title, blocks);
  return {
    title: title || '未命名文章', summary: '', blocks, ignoredImages,
    ...consistency
  };
}
