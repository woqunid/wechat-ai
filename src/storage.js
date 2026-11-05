const DB = 'weave-local';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 4);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    for (const name of ['drafts', 'inputs', 'snapshots', 'aiEditAttachments']) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('history')) {
      const history = db.createObjectStore('history', { keyPath: 'id' });
      history.createIndex('expiresAt', 'expiresAt');
    }
  };
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

const transact = async (storeName, action, value) => {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(storeName, action === 'get' ? 'readonly' : 'readwrite');
      const store = transaction.objectStore(storeName);
      const request = action === 'get' ? store.get('current') : action === 'clear' ? store.clear() : action === 'delete' ? store.delete(value.id) : store.put({ id: 'current', ...value });
      let resultValue;
      request.onsuccess = () => { resultValue = request.result; };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(resultValue);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('本地存储失败'));
    });
  } finally {
    db.close();
  }
};

export const saveDraft = draft => transact('drafts', 'put', draft);
export const loadDraft = () => transact('drafts', 'get');
export const saveInputs = input => transact('inputs', 'put', { input });
export const loadInputs = () => transact('inputs', 'get');
export const saveSnapshot = snapshot => transact('snapshots', 'put', { snapshot });
export const loadSnapshot = () => transact('snapshots', 'get');
export const clearSnapshot = () => transact('snapshots', 'clear');
export const clearDrafts = async () => {
  await transact('drafts', 'clear');
  await transact('snapshots', 'clear');
  await transact('aiEditAttachments', 'clear');
};
export const clearInputs = () => transact('inputs', 'clear');

export const HISTORY_LIFETIME = 30 * 86_400_000;

export async function pruneArticleHistory(now = Date.now()) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('history', 'readwrite');
      const store = transaction.objectStore('history');
      const request = store.index('expiresAt').openCursor(IDBKeyRange.upperBound(now));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('历史记录清理失败'));
    });
  } finally { db.close(); }
}

export async function listArticleHistory() {
  await pruneArticleHistory();
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('history').objectStore('history').getAll();
      request.onsuccess = () => resolve(request.result.sort((a, b) => b.savedAt - a.savedAt));
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveArticleHistory(article, assets) {
  const savedAt = Date.now();
  const assetIds = new Set(article.blocks.filter(block => block.assetId).map(block => block.assetId));
  const record = {
    id: article.id,
    title: article.title || '未命名文章',
    article,
    assets: [...assetIds].flatMap(id => {
      const asset = assets.get(id);
      if (!asset) return [];
      const { blob, previewUrl, ...metadata } = asset;
      return [metadata];
    }),
    savedAt,
    expiresAt: savedAt + HISTORY_LIFETIME,
  };
  await pruneArticleHistory(savedAt);
  await transact('history', 'put', record);
  return record;
}

export const deleteArticleHistory = id => transact('history', 'delete', { id });

const cachedAttachment = ({ previewUrl, images, ...attachment }) => ({
  ...attachment,
  ...(images ? { images: images.map(({ previewUrl: imagePreviewUrl, ...image }) => image) } : {}),
});

export async function saveAIEditAttachments(articleId, attachments) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction('aiEditAttachments', 'readwrite');
      transaction.objectStore('aiEditAttachments').put({ id: articleId, attachments: attachments.map(cachedAttachment) });
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('附件缓存失败'));
    });
  } finally { db.close(); }
}

export async function loadAIEditAttachments(articleId) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction('aiEditAttachments').objectStore('aiEditAttachments').get(articleId);
      request.onsuccess = () => resolve(request.result?.attachments || []);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function saveAsset(asset, blob) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction('assets', 'readwrite');
    transaction.objectStore('assets').put({ id: asset.id, asset: { ...asset, previewUrl: undefined }, blob });
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('图片保存失败'));
  });
  db.close();
}

export async function loadAssets() {
  const db = await openDb();
  const rows = await new Promise((resolve, reject) => {
    const request = db.transaction('assets').objectStore('assets').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return rows.map(row => ({ ...row.asset, previewUrl: row.blob ? URL.createObjectURL(row.blob) : row.asset.cacheUrl || row.asset.url, blob: row.blob }));
}

export async function deleteAsset(id) {
  await transact('assets', 'delete', { id });
}

export async function clearAssets() {
  await transact('assets', 'clear');
}
