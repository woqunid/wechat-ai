const DB = 'weave-local';

const openDb = () => new Promise((resolve, reject) => {
  const request = indexedDB.open(DB, 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
    for (const name of ['drafts', 'inputs', 'snapshots']) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
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
};
export const clearInputs = () => transact('inputs', 'clear');

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
  return rows.map(row => ({ ...row.asset, previewUrl: URL.createObjectURL(row.blob), blob: row.blob }));
}

export async function deleteAsset(id) {
  await transact('assets', 'delete', { id });
}

export async function clearAssets() {
  await transact('assets', 'clear');
}
