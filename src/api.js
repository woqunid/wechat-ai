const checkedData = (status, data, fallback) => {
  if (status >= 200 && status < 300) return data;
  throw Object.assign(new Error(data.error?.message || fallback), { code: data.error?.code, status });
};

export async function requestJson(url, { fallback = '请求失败，请重试', ...options } = {}) {
  const response = await fetch(url, options);
  return checkedData(response.status, await response.json().catch(() => ({})), fallback);
}

// 服务端未进入流式（校验失败、限流等）时仍是普通 JSON，结果与 postJson 一致。
export async function postStream(url, body, { onEvent, fallback = '请求失败，请重试', ...options } = {}) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify(body), ...options });
  if (!response.headers.get('content-type')?.includes('application/x-ndjson')) return checkedData(response.status, await response.json().catch(() => ({})), fallback);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) throw new Error(fallback);
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line);
      if (event.type === 'done') return checkedData(event.status, event.body, fallback);
      onEvent?.(event);
    }
  }
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
