import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

test('管理 API 要求密码会话并复用模型发现功能', { timeout: 20_000 }, async t => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const directory = await fs.mkdtemp(path.join(tmpdir(), 'wechat-admin-test-'));
  t.after(async () => {
    assert.ok(path.resolve(directory).startsWith(path.resolve(tmpdir()) + path.sep + 'wechat-admin-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(resolve => socket.close(resolve));
  const bootstrap = `
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://admin-model-test.invalid/v1/models') return Response.json({data:[{id:'z-model'},{id:'a-model'}]});
      throw new Error('unexpected upstream request');
    };
    await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/index.js')).href)});
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', bootstrap], {
    cwd: root,
    env: { ...process.env, PORT: String(port), ASSET_DIR: path.join(directory, 'assets'), BAOLONG_ADMIN_PASSWORD: 'test-only-admin-password', AI_BASE_URL: '', AI_API_KEY: '', AI_MODEL: '', ALLOWED_ORIGIN: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit'); } });
  let errors = '';
  child.stderr.on('data', chunk => { errors += chunk; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Test API did not start: ${errors}`)), 8000);
    child.stdout.on('data', chunk => { if (String(chunk).includes('server listening')) { clearTimeout(timer); resolve(); } });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Test API exited: ${code} ${errors}`)); });
  });

  const base = `http://127.0.0.1:${port}`;
  const origin = { Origin: base };
  const request = (route, options = {}) => fetch(base + route, options);
  assert.equal((await request('/api/admin/session')).status, 401);
  const failedLogin = await request('/api/admin/login', { method: 'POST', headers: { ...origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'wrong' }) });
  assert.equal(failedLogin.status, 401);
  const login = await request('/api/admin/login', { method: 'POST', headers: { ...origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'test-only-admin-password' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Strict/);
  const cookieHeader = { Cookie: cookie.split(';')[0] };
  assert.equal((await request('/api/admin/session', { headers: cookieHeader })).status, 200);
  const config = await request('/api/admin/config', { headers: cookieHeader }).then(response => response.json());
  assert.equal(config.hasApiKey, false);
  assert.equal(Object.hasOwn(config, 'apiKey'), false);
  const modelsResponse = await request('/api/admin/models', { method: 'POST', headers: { ...cookieHeader, 'Content-Type': 'application/json', ...origin }, body: JSON.stringify({ baseUrl: 'https://admin-model-test.invalid/v1', apiKey: 'test-key' }) });
  assert.equal(modelsResponse.status, 200);
  const models = await modelsResponse.json();
  assert.deepEqual(models.models, ['a-model', 'z-model']);
  assert.equal((await request('/api/admin/models', { method: 'POST', headers: { ...cookieHeader, 'Content-Type': 'application/json' }, body: JSON.stringify({ baseUrl: 'https://admin-model-test.invalid/v1', apiKey: 'test-key' }) })).status, 403);
  const logout = await request('/api/admin/logout', { method: 'POST', headers: { ...origin, ...cookieHeader } });
  assert.equal(logout.status, 200);
  assert.equal((await request('/api/admin/config', { headers: cookieHeader })).status, 401);
});
