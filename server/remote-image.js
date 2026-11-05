import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const blocked = new BlockList();
for (const [address, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
  ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24],
  ['224.0.0.0', 4], ['240.0.0.0', 4]
]) blocked.addSubnet(address, prefix, 'ipv4');
blocked.addSubnet('2001::', 23, 'ipv6');
blocked.addSubnet('2001:db8::', 32, 'ipv6');
blocked.addSubnet('2002::', 16, 'ipv6');
const publicV6 = new BlockList();
publicV6.addSubnet('2000::', 3, 'ipv6');
const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
const publicAddress = ({ address, family }) => family === 4
  ? !blocked.check(address, 'ipv4')
  : family === 6 && publicV6.check(address, 'ipv6') && !blocked.check(address, 'ipv6');

function imageUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw fail('INVALID_IMAGE_URL', '请输入完整的 HTTPS 图片链接');
  let url;
  try { url = new URL(value.trim()); } catch { throw fail('INVALID_IMAGE_URL', '请输入完整的 HTTPS 图片链接'); }
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) throw fail('INVALID_IMAGE_URL', '仅支持无需登录的公网 HTTPS 图片链接');
  url.hash = '';
  return url;
}

async function download(url, signal) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  const family = isIP(hostname);
  const addresses = family ? [{ address: hostname, family }] : await new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    lookup(hostname, { all: true }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    if (signal.aborted) abort();
  });
  signal.throwIfAborted();
  if (!addresses.length || !addresses.every(publicAddress)) throw fail('IMAGE_URL_NOT_PUBLIC', '图片链接必须指向公网地址');
  const chosen = addresses.find(address => address.family === 4) || addresses[0];
  return new Promise((resolve, reject) => {
    const req = request(url, {
      agent: false,
      family: chosen.family,
      autoSelectFamily: false,
      // 固定到已校验的解析结果，避免连接时再次解析域名。
      lookup: (_hostname, options, callback) => options.all ? callback(null, [chosen]) : callback(null, chosen.address, chosen.family),
      signal,
      headers: { Accept: 'image/jpeg,image/png,image/webp', 'User-Agent': 'Weave-Image-Import/1.0' }
    }, res => {
      res.on('error', reject);
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
        const location = res.headers.location;
        res.destroy();
        if (!location) reject(fail('IMAGE_IMPORT_FAILED', '图片链接跳转地址无效'));
        else resolve({ location });
        return;
      }
      if (res.statusCode !== 200) {
        res.destroy();
        reject(fail('IMAGE_IMPORT_FAILED', '图片无法读取，请检查链接是否过期、需要登录或限制外部访问'));
        return;
      }
      const mime = String(res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (mime && !['image/jpeg', 'image/jpg', 'image/pjpeg', 'image/png', 'image/x-png', 'image/webp', 'application/octet-stream', 'binary/octet-stream'].includes(mime)) {
        res.destroy(); reject(fail('INVALID_IMAGE', '该链接不是 JPG、PNG 或 WebP 图片')); return;
      }
      if (Number(res.headers['content-length']) > MAX_IMAGE_BYTES) {
        res.destroy(); reject(fail('IMAGE_TOO_LARGE', '图片超过 10MB')); return;
      }
      const chunks = [];
      let bytes = 0;
      res.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > MAX_IMAGE_BYTES) res.destroy(fail('IMAGE_TOO_LARGE', '图片超过 10MB'));
        else chunks.push(chunk);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function fetchRemoteImage(value, externalSignal) {
  const signal = AbortSignal.any([externalSignal, AbortSignal.timeout(15_000)].filter(Boolean));
  let url = imageUrl(value);
  const sourceUrl = url.href;
  try {
    for (let redirects = 0; redirects <= 3; redirects++) {
      signal.throwIfAborted();
      const result = await download(url, signal);
      if (result.buffer) return { buffer: result.buffer, sourceUrl };
      url = imageUrl(new URL(result.location, url).href);
    }
    throw fail('IMAGE_IMPORT_FAILED', '图片链接跳转过多，请使用图片直链');
  } catch (error) {
    if (externalSignal?.aborted) throw error;
    if (signal.aborted) throw fail('IMAGE_IMPORT_TIMEOUT', '图片读取超时，请检查链接后重试', 504);
    if (error.status) throw error;
    throw fail('IMAGE_IMPORT_FAILED', '图片无法读取，请检查链接或稍后重试', 502);
  }
}
