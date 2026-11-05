const DB = 'weave-local';
export const DRAFT_LIFETIME = 30 * 86_400_000;

const draftContent = draft => JSON.stringify([draft.article, draft.generationInput ?? null]);
const draftRecord = (draft, previous, now = Date.now()) => {
  const updatedAt = previous && draftContent(previous) === draftContent(draft) ? previous.updatedAt : now;
  return { ...draft, id: draft.article.id, updatedAt, expiresAt: updatedAt + DRAFT_LIFETIME };
};

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 5);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    for (const name of ['drafts', 'inputs', 'snapshots', 'aiEditAttachments']) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
    }
    if (!db.objectStoreNames.contains('workspace')) {
      db.createObjectStore('workspace', { keyPath: 'id' });
      const transaction = request.transaction;
      const drafts = transaction.objectStore('drafts');
      const legacy = drafts.get('current');
      const input = transaction.objectStore('inputs').get('current');
      const snapshot = transaction.objectStore('snapshots').get('current');
      let remaining = 3;
      for (const item of [legacy, input, snapshot]) item.onsuccess = () => {
        if (--remaining || !legacy.result?.article) return;
        const previous = legacy.result;
        const generationInput = Object.hasOwn(previous, 'generationInput') ? previous.generationInput : input.result?.input;
        const savedSnapshot = Object.hasOwn(previous, 'snapshot') ? previous.snapshot : snapshot.result?.snapshot;
        drafts.put(draftRecord({ article: previous.article, generationInput: generationInput ?? null, snapshot: savedSnapshot ?? null }, null));
        drafts.delete('current');
        if (JSON.stringify(input.result?.input) === JSON.stringify(generationInput)) transaction.objectStore('inputs').clear();
        transaction.objectStore('snapshots').clear();
      };
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

export async function saveDraft(draft, { page, clearInput = false } = {}) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(['drafts', 'workspace', 'inputs'], 'readwrite');
      const drafts = transaction.objectStore('drafts');
      const request = drafts.get(draft.article.id);
      let record;
      request.onsuccess = () => {
        record = draftRecord(draft, request.result);
        drafts.put(record);
        if (page) transaction.objectStore('workspace').put({ id: 'current', page, articleId: page === 'edit' ? record.id : null });
        if (clearInput) transaction.objectStore('inputs').clear();
      };
      transaction.oncomplete = () => resolve(record);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('草稿保存失败'));
    });
  } finally { db.close(); }
}

export async function loadDraft(id) {
  const records = await listDrafts();
  return id ? records.find(record => record.id === id) : records[0];
}

export async function listDrafts(now = Date.now()) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(['drafts', 'aiEditAttachments', 'workspace'], 'readwrite');
      const request = transaction.objectStore('drafts').getAll();
      let records;
      request.onsuccess = () => {
        records = request.result.filter(record => record.expiresAt > now).sort((a, b) => b.updatedAt - a.updatedAt);
        for (const record of request.result.filter(record => record.expiresAt <= now)) {
          transaction.objectStore('drafts').delete(record.id);
          transaction.objectStore('aiEditAttachments').delete(record.id);
        }
        const session = transaction.objectStore('workspace').get('current');
        session.onsuccess = () => {
          if (session.result?.page === 'edit' && !records.some(record => record.id === session.result.articleId))
            transaction.objectStore('workspace').put({ id: 'current', page: 'create', articleId: null });
        };
      };
      transaction.oncomplete = () => resolve(records);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('草稿读取失败'));
    });
  } finally { db.close(); }
}

export async function deleteDraft(id) {
  const db = await openDb();
  try {
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['drafts', 'aiEditAttachments', 'workspace'], 'readwrite');
      transaction.objectStore('drafts').delete(id);
      transaction.objectStore('aiEditAttachments').delete(id);
      const request = transaction.objectStore('workspace').get('current');
      request.onsuccess = () => {
        if (request.result?.articleId === id) transaction.objectStore('workspace').put({ id: 'current', page: 'create', articleId: null });
      };
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('草稿删除失败'));
    });
  } finally { db.close(); }
}

export const loadWorkspaceSession = () => transact('workspace', 'get');
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
