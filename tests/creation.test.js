import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ArticleSchema } from '../src/core.js';
import { bodyLengthStatus, lengthNotice, validTargetLength } from '../src/creation.js';
import { generationInstructions, inspectDraft } from '../server/writing-rules.js';

const paragraph = chars => ({ id: `b${chars}`, type: 'paragraph', runs: [{ text: '字'.repeat(chars) }] });

test('自定义字数：范围校验、允许区间与修订要求', () => {
  assert.deepEqual([299, 300, 3000, 3001, 1200.5, '1200'].map(validTargetLength), [false, true, true, false, false, false]);
  assert.deepEqual(bodyLengthStatus([paragraph(1000)], 1200), { actual: 1000, target: 1200, min: 1020, max: 1380, within: false });
  assert.match(generationInstructions({ mode: 'create', tone: 'plain', targetLength: 1200 }), /正文目标1200字，允许1020至1380字/);
  assert.match(inspectDraft({ title: '', blocks: [paragraph(1000)] }, { targetLength: 1200 }).issues[0], /正文实测1000字，要求1020至1380字/);
  assert.deepEqual(inspectDraft({ title: '', blocks: [paragraph(1100)] }, { targetLength: 1200 }).issues, []);
  assert.equal(lengthNotice(bodyLengthStatus([paragraph(1000)], 1200)), '正文 1000 字，少于目标范围 1020–1380 字，可用 AI 修改调整');
  assert.equal(lengthNotice(bodyLengthStatus([paragraph(1100)], 1200)), '');
});

test('草稿设置接受范围内的自定义字数', () => {
  const now = new Date().toISOString();
  const article = targetLength => ({ schemaVersion: 1, id: 'a', mode: 'create', title: '', summary: '', blocks: [], templateId: 'T01', settings: { targetLength }, createdAt: now, updatedAt: now });
  assert.deepEqual([1200, 5000, 1200.5].map(value => ArticleSchema.safeParse(article(value)).success), [true, false, false]);
});
