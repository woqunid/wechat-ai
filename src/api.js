export async function requestJson(url, { fallback = '请求失败，请重试', ...options } = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error?.message || fallback), { code: data.error?.code, status: response.status });
  return data;
}

export const postJson = (url, body, options = {}) => requestJson(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  ...options,
});

export async function uploadAsset(file, { filename, signal, fallback = '图片上传失败' } = {}) {
  const form = new FormData();
  if (filename) form.append('file', file, filename);
  else form.append('file', file);
  return (await requestJson('/api/assets', { method: 'POST', body: form, signal, fallback })).asset;
}

export const absoluteUrl = url => new URL(url, window.location.origin).href;

export async function assetAvailable(url, signal = AbortSignal.timeout(10_000)) {
  return (await fetch(url, { method: 'HEAD', signal })).ok;
}

export function downloadJson(payload, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
