import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { indexedDB, IDBKeyRange } from 'fake-indexeddb';
import { clearAssets, clearDrafts, deleteArticleHistory, HISTORY_LIFETIME, listArticleHistory, loadDraft, pruneArticleHistory, saveArticleHistory, saveDraft } from '../src/storage.js';

globalThis.indexedDB = indexedDB;
globalThis.IDBKeyRange = IDBKeyRange;

const article = (id = 'article-first') => ({
  id, title: '已定稿的文章', templateId: 'T06',
  html: '<section style="padding:24px;color:#26332f;"><p style="line-height:1.8;">完整正文</p><img data-asset-id="img_first" style="width:65%;"></section>',
  blocks: [{ id: 'image', type: 'imageCard', assetId: 'img_first' }],
  settings: { accountName: '公众号' },
});
const assets = () => new Map([['img_first', { id: 'img_first', url: 'https://example.com/image.png', cacheUrl: '/uploads/img_first.png', expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), blob: new Blob(['image']), previewUrl: 'blob:temporary' }]]);

beforeEach(async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase('weave-local');
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
});

test('升级原有数据库时保留当前草稿并新增历史仓库', async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('weave-local', 3);
    request.onupgradeneeded = () => {
      for (const name of ['assets', 'drafts', 'inputs', 'snapshots', 'aiEditAttachments']) request.result.createObjectStore(name, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('drafts', 'readwrite');
    transaction.objectStore('drafts').put({ id: 'current', article: article() });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  assert.deepEqual(await listArticleHistory(), []);
  assert.deepEqual((await loadDraft()).article, article());
});

test('手动保存完整 HTML 和样式，仅保存引用图片的元数据', async () => {
  const source = article();
  const images = assets();
  images.set('img_unused', { id: 'img_unused' });
  const saved = await saveArticleHistory(source, images);
  assert.equal(saved.expiresAt - saved.savedAt, HISTORY_LIFETIME);
  source.html = '未保存的改动';
  const [record] = await listArticleHistory();
  assert.equal(record.article.html, article().html);
  assert.equal(record.assets.length, 1);
  assert.equal(record.assets[0].cacheUrl, '/uploads/img_first.png');
  assert.ok(!Object.hasOwn(record.assets[0], 'blob'));
  assert.ok(!Object.hasOwn(record.assets[0], 'previewUrl'));
  assert.deepEqual(Object.keys(record).sort(), ['article', 'assets', 'expiresAt', 'id', 'savedAt', 'title']);
});

test('自动草稿不会覆盖手动历史，再次保存更新同一条记录并续期', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const source = article();
    const saved = await saveArticleHistory(source, assets());
    await saveDraft({ article: { ...source, html: '未确认的样式' } });
    assert.equal((await listArticleHistory())[0].article.html, source.html);
    now += 86_400_000;
    const changed = { ...source, title: '更新后的标题', html: '<p style="color:#334455;">最终样式</p>' };
    await saveArticleHistory(changed, assets());
    const records = await listArticleHistory();
    assert.equal(records.length, 1);
    assert.equal(records[0].article.html, changed.html);
    assert.equal(records[0].title, changed.title);
    assert.equal(records[0].expiresAt, saved.expiresAt + 86_400_000);
  } finally { Date.now = originalNow; }
});

test('历史按保存时间倒序排列，删除和清空草稿互不影响', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    await saveArticleHistory(article('first'), assets());
    now += 1000;
    await saveArticleHistory(article('second'), assets());
    await saveDraft({ article: article('current') });
    await clearAssets();
    await clearDrafts();
    assert.deepEqual((await listArticleHistory()).map(record => record.id), ['second', 'first']);
    await deleteArticleHistory('second');
    assert.deepEqual((await listArticleHistory()).map(record => record.id), ['first']);
    await deleteArticleHistory('first');
    assert.deepEqual(await listArticleHistory(), []);
  } finally { Date.now = originalNow; }
});

test('第 30 天到期边界自动清理，未到期记录保留', async () => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  try {
    const first = await saveArticleHistory(article('first'), assets());
    now += 1000;
    await saveArticleHistory(article('second'), assets());
    await pruneArticleHistory(first.expiresAt - 1);
    assert.equal((await listArticleHistory()).length, 2);
    now = first.expiresAt;
    assert.deepEqual((await listArticleHistory()).map(record => record.id), ['second']);
    now += 1000;
    assert.deepEqual(await listArticleHistory(), []);
  } finally { Date.now = originalNow; }
});
