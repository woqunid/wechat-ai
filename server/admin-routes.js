import { ADMIN_SESSION_COOKIE, ADMIN_SESSION_TTL_SECONDS, createAdminSession, verifyAdminPassword, verifyAdminSession } from './admin-auth.js';
import { fetchModels, getAIConfig, normalizeBaseUrl, resolveCredentials, safeAIStatus } from './ai-config.js';
import { writePlatformAIConfig } from './env-config.js';
import { configError, isAllowedOrigin, rateLimit, sendError } from './http.js';

const adminSessions = new Map();
const adminPassword = () => process.env.BAOLONG_ADMIN_PASSWORD || '';
const readAdminCookie = req => {
  for (const item of (req.headers.cookie || '').split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== ADMIN_SESSION_COOKIE) continue;
    return item.slice(separator + 1).trim();
  }
  return '';
};
const sessionCookie = (req, value, maxAge) => `${ADMIN_SESSION_COOKIE}=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${req.secure ? '; Secure' : ''}`;
const isActiveAdminSession = session => {
  const expiresAt = adminSessions.get(session);
  if (!expiresAt || expiresAt <= Math.floor(Date.now() / 1000) || !verifyAdminSession(session, adminPassword())) {
    adminSessions.delete(session);
    return false;
  }
  return true;
};
const requireAdmin = (req, res, next) => {
  if (!adminPassword()) return sendError(res, 503, 'ADMIN_AUTH_NOT_CONFIGURED', '服务器尚未设置管理访问密码');
  if (!isActiveAdminSession(readAdminCookie(req))) return sendError(res, 401, 'ADMIN_AUTH_REQUIRED', '请先登录管理页面');
  next();
};
const requireAdminOrigin = (req, res, next) => req.get('origin') && isAllowedOrigin(req) ? next() : sendError(res, 403, 'ORIGIN_NOT_ALLOWED', '管理请求来源无效');
const adminAIConfig = () => {
  try { return getAIConfig(); }
  catch { return { baseUrl: '', apiKey: process.env.AI_API_KEY || '' }; }
};
const adminCredentials = body => {
  const baseUrl = normalizeBaseUrl(body?.baseUrl);
  const suppliedKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
  const saved = adminAIConfig();
  return { ...resolveCredentials({ baseUrl, apiKey: suppliedKey || (baseUrl === saved.baseUrl ? saved.apiKey : '') }), baseUrl };
};

export function registerAdminRoutes(app, { envPath }) {
  app.get('/api/admin/session', requireAdmin, (req, res) => res.json({ authenticated: true }));
  app.post('/api/admin/login', rateLimit(8, 'RATE_ADMIN_LOGIN_PER_MIN'), requireAdminOrigin, (req, res) => {
    const password = adminPassword();
    if (!password) return sendError(res, 503, 'ADMIN_AUTH_NOT_CONFIGURED', '服务器尚未设置管理访问密码');
    if (!verifyAdminPassword(req.body?.password, password)) return sendError(res, 401, 'ADMIN_AUTH_FAILED', '访问密码不正确');
    const session = createAdminSession(password);
    const now = Math.floor(Date.now() / 1000);
    for (const [token, expiresAt] of adminSessions) if (expiresAt <= now) adminSessions.delete(token);
    adminSessions.set(session, Number(session.split('.')[0]));
    res.setHeader('Set-Cookie', sessionCookie(req, session, ADMIN_SESSION_TTL_SECONDS));
    res.json({ authenticated: true });
  });
  app.post('/api/admin/logout', requireAdminOrigin, (req, res) => {
    adminSessions.delete(readAdminCookie(req));
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
    res.json({ authenticated: false });
  });
  app.get('/api/admin/config', requireAdmin, (req, res) => res.json(safeAIStatus('平台 AI 配置无效')));
  app.post('/api/admin/models', rateLimit(20, 'RATE_CONFIG_PER_MIN'), requireAdmin, requireAdminOrigin, async (req, res) => {
    try {
      const credentials = adminCredentials(req.body);
      res.json({ baseUrl: credentials.baseUrl, models: await fetchModels(credentials) });
    } catch (error) { configError(res, error); }
  });
  app.post('/api/admin/config', rateLimit(10, 'RATE_CONFIG_PER_MIN'), requireAdmin, requireAdminOrigin, async (req, res) => {
    try {
      const credentials = adminCredentials(req.body);
      const model = typeof req.body?.model === 'string' ? req.body.model.trim() : '';
      if (!model || model.length > 256) return sendError(res, 400, 'INVALID_MODEL', '请选择有效模型');
      const models = await fetchModels(credentials);
      if (!models.includes(model)) return sendError(res, 400, 'INVALID_MODEL', '模型不在服务返回的可用列表中，请重新获取模型');
      await writePlatformAIConfig(envPath, { AI_BASE_URL: credentials.baseUrl, AI_API_KEY: credentials.apiKey, AI_MODEL: model });
      process.env.AI_BASE_URL = credentials.baseUrl;
      process.env.AI_API_KEY = credentials.apiKey;
      process.env.AI_MODEL = model;
      res.json(safeAIStatus('平台 AI 配置无效'));
    } catch (error) {
      if (error.code) return configError(res, error);
      console.error('Unable to persist platform AI configuration');
      sendError(res, 500, 'AI_CONFIG_WRITE_FAILED', '无法写入 .env，请检查服务目录的写入权限');
    }
  });
}
