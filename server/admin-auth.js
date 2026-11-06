import crypto from 'node:crypto';

export const ADMIN_SESSION_COOKIE = 'baolong_admin_session';
export const ADMIN_SESSION_TTL_SECONDS = 8 * 60 * 60;

const digest = value => crypto.createHash('sha256').update(value).digest();
const signature = (password, expiresAt) => crypto.createHmac('sha256', password).update(`baolongadmin:${expiresAt}`).digest('base64url');

export function verifyAdminPassword(candidate, password = process.env.BAOLONG_ADMIN_PASSWORD || '') {
  if (!password || password.length > 1024 || typeof candidate !== 'string' || candidate.length > 1024) return false;
  return crypto.timingSafeEqual(digest(candidate), digest(password));
}

export function createAdminSession(password, now = Date.now()) {
  const expiresAt = Math.floor(now / 1000) + ADMIN_SESSION_TTL_SECONDS;
  return `${expiresAt}.${signature(password, expiresAt)}`;
}

export function verifyAdminSession(value, password = process.env.BAOLONG_ADMIN_PASSWORD || '', now = Date.now()) {
  if (!password || typeof value !== 'string') return false;
  const [expiresText, receivedSignature, ...extra] = value.split('.');
  const expiresAt = Number(expiresText);
  if (extra.length || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(now / 1000)) return false;
  const expected = Buffer.from(signature(password, expiresAt));
  const received = Buffer.from(receivedSignature || '');
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}
