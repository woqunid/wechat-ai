import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { fetchRemoteImage } from '../server/remote-image.js';

const proxyKeys = ['HTTPS_PROXY', 'https_proxy', 'NO_PROXY', 'no_proxy'];
const useProxyEnv = (t, values) => {
  const previous = Object.fromEntries(proxyKeys.map(key => [key, process.env[key]]));
  for (const key of proxyKeys) delete process.env[key];
  Object.assign(process.env, values);
  t.after(() => {
    for (const key of proxyKeys) delete process.env[key];
    for (const key of proxyKeys) if (previous[key] !== undefined) process.env[key] = previous[key];
  });
};
const rejectingProxy = async t => {
  const targets = [];
  const server = createServer();
  server.on('connect', (req, socket) => { targets.push(req.url); socket.end('HTTP/1.1 403 Forbidden\r\n\r\n'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { targets, url: `http://127.0.0.1:${server.address().port}` };
};

test('配置 HTTPS_PROXY 后通过代理连接已校验的 IP', async t => {
  const proxy = await rejectingProxy(t);
  useProxyEnv(t, { HTTPS_PROXY: proxy.url });
  for (const url of ['https://1.1.1.1/a.jpg', 'https://[2606:4700:4700::1111]/a.jpg']) {
    await assert.rejects(fetchRemoteImage(url), { code: 'IMAGE_PROXY_FAILED', status: 502 });
  }
  assert.deepEqual(proxy.targets, ['1.1.1.1:443', '[2606:4700:4700::1111]:443']);
});

test('NO_PROXY 命中的地址不经过代理', async t => {
  const proxy = await rejectingProxy(t);
  useProxyEnv(t, { HTTPS_PROXY: proxy.url, NO_PROXY: 'localhost,1.1.1.1' });
  await assert.rejects(fetchRemoteImage('https://1.1.1.1/a.jpg', AbortSignal.timeout(200)));
  assert.deepEqual(proxy.targets, []);
});

test('HTTPS_PROXY 仅支持 http 代理', async t => {
  useProxyEnv(t, { HTTPS_PROXY: 'socks5://127.0.0.1:1080' });
  await assert.rejects(fetchRemoteImage('https://1.1.1.1/a.jpg'), { code: 'IMAGE_PROXY_INVALID', status: 500 });
});
