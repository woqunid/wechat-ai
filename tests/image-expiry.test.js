import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assetExpired, imageExpiry } from '../src/image-expiry.js';

const DAY = 86_400_000;
const now = Date.parse('2026-06-01T00:00:00Z');
const expiresIn = days => new Date(now + days * DAY).toISOString();

test('按服务器缓存到期时间区分已过期、即将过期和可恢复图片', () => {
  const blob = new Blob(['x']);
  const assets = new Map([
    ['img_ok', { id: 'img_ok', expiresAt: expiresIn(20) }],
    ['img_soon', { id: 'img_soon', expiresAt: expiresIn(2.5), blob }],
    ['img_old', { id: 'img_old', expiresAt: expiresIn(-1) }],
    ['img_broken', { id: 'img_broken', expiresAt: expiresIn(20), pasteStatus: 'broken', blob }],
  ]);
  const imageBlock = (id, assetId) => ({ id, type: 'imageCard', assetId });
  const blocks = [imageBlock('a', 'img_ok'), imageBlock('b', 'img_soon'), imageBlock('c', 'img_soon'), imageBlock('d', 'img_old'), imageBlock('e', 'img_broken'), imageBlock('f', 'img_gone'), { id: 'g', type: 'paragraph', runs: [] }];
  const result = imageExpiry({ blocks }, assets, now);
  assert.deepEqual(result.expired, ['img_old', 'img_broken', 'img_gone']);
  assert.deepEqual(result.expiring, ['img_soon']);
  assert.equal(result.days, 3);
  assert.deepEqual(result.restorable, ['img_broken', 'img_soon']);
  assert.equal(imageExpiry({ blocks: [imageBlock('a', 'img_ok')] }, assets, now).days, 0);
  assert.equal(assetExpired({ expiresAt: expiresIn(-1) }, now), true);
  assert.equal(assetExpired({ expiresAt: expiresIn(1) }, now), false);
});
