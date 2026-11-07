import { absoluteUrl, postJson } from './api.js';

export function imageLink(value) {
  if (typeof value !== 'string' || value.length > 4096 || /\s/.test(value.trim())) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return null;
    url.hash = '';
    return url.href;
  } catch { return null; }
}

export async function readImageLink(value, signal) {
  const url = imageLink(value);
  if (!url) throw new Error('请输入无需登录的 HTTPS 图片直链');
  const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)].filter(Boolean));
  const data = await postJson('/api/assets/import', { url }, { signal: requestSignal, fallback: '图片读取失败' });
  const cached = await fetch(data.asset.cacheUrl, { signal: requestSignal });
  if (!cached.ok) throw new Error('图片缓存无法读取，请重新导入');
  const blob = await cached.blob();
  return { ...data.asset, url: absoluteUrl(data.asset.url), blob, previewUrl: URL.createObjectURL(blob) };
}
