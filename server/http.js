export const sendError = (res, status, code, message) => res.status(status).json({ error: { code, message } });
export const configError = (res, error) => sendError(res, error.status || 400, error.code || 'AI_CONFIG_ERROR', error.message || 'AI 配置操作失败');

export const allowedOrigins = () => (process.env.ALLOWED_ORIGIN?.split(',') || ['http://localhost:5173', 'http://127.0.0.1:5173']).map(value => value.trim()).filter(Boolean);

export const isAllowedOrigin = req => {
  const origin = req.get('origin');
  if (!origin) return true;
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0].trim();
  const forwardedProtocol = req.get('x-forwarded-proto')?.split(',')[0].trim();
  const requestHost = (forwardedHost || req.get('host') || '').toLowerCase();
  const requestProtocol = (forwardedProtocol || req.protocol).replace(/:$/, '').toLowerCase();
  let sameOrigin = false;
  try {
    const parsedOrigin = new URL(origin);
    sameOrigin = parsedOrigin.host.toLowerCase() === requestHost && parsedOrigin.protocol === `${requestProtocol}:`;
  } catch {}
  return sameOrigin || allowedOrigins().includes(origin);
};

export const requireOrigin = (message = '当前页面来源未被服务端允许') => (req, res, next) => isAllowedOrigin(req) ? next() : sendError(res, 403, 'ORIGIN_NOT_ALLOWED', message);

const oneMinute = new Map();
export function rateLimit(defaultLimit, setting) {
  return (req, res, next) => {
    const limit = Number(process.env[setting] || defaultLimit);
    const key = `${req.ip}:${req.path}`;
    const now = Date.now();
    const state = oneMinute.get(key) || { start: now, count: 0 };
    if (now - state.start >= 60_000) { state.start = now; state.count = 0; }
    if (++state.count > limit) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((60_000 - (now - state.start)) / 1000))));
      return sendError(res, 429, 'RATE_LIMITED', '请求过于频繁，请稍后再试');
    }
    oneMinute.set(key, state);
    next();
  };
}

const activeGenerations = new Map();
let totalGenerations = 0;
export const concurrentGenerationLimit = (req, res, next) => {
  const active = activeGenerations.get(req.ip) || 0;
  const busySource = active >= Number(process.env.GENERATION_CONCURRENCY_PER_SOURCE || 2);
  if (busySource || totalGenerations >= Number(process.env.GENERATION_CONCURRENCY_TOTAL || 6)) {
    res.setHeader('Retry-After', '5');
    return sendError(res, 429, 'RATE_LIMITED', busySource ? '已有生成任务进行中，请等待完成后再试' : '生成任务较多，请稍后再试');
  }
  activeGenerations.set(req.ip, active + 1);
  totalGenerations++;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    totalGenerations--;
    const count = activeGenerations.get(req.ip) - 1;
    if (count > 0) activeGenerations.set(req.ip, count); else activeGenerations.delete(req.ip);
  };
  res.once('finish', release);
  res.once('close', release);
  next();
};
