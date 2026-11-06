import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdminSession, verifyAdminPassword, verifyAdminSession, ADMIN_SESSION_TTL_SECONDS } from '../server/admin-auth.js';

test('管理密码使用恒定时间比较，会话签名在过期或密码变化后失效', () => {
  const password = 'test-only-admin-password';
  const now = Date.parse('2026-11-06T12:00:00Z');
  const session = createAdminSession(password, now);
  assert.equal(verifyAdminPassword(password, password), true);
  assert.equal(verifyAdminPassword('wrong-password', password), false);
  assert.equal(verifyAdminSession(session, password, now), true);
  assert.equal(verifyAdminSession(session, 'different-password', now), false);
  assert.equal(verifyAdminSession(session, password, now + (ADMIN_SESSION_TTL_SECONDS + 1) * 1000), false);
  assert.equal(verifyAdminSession('malformed', password, now), false);
});
