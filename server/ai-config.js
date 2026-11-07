const fail = (code, message, status = 400) => Object.assign(new Error(message), { code, status });
let discoveredEnvironmentConfig = null;

export function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || value.length > 2048) throw fail('INVALID_AI_URL', '请输入有效的服务 URL');
  let url;
  try { url = new URL(value.trim()); } catch { throw fail('INVALID_AI_URL', '请输入完整的 http:// 或 https:// 服务 URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw fail('INVALID_AI_URL', '服务 URL 仅支持 HTTP/HTTPS，不能包含账号、查询参数或锚点');
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/(?:models|responses|chat\/completions)$/, '') || '/v1';
  return url.href.replace(/\/$/, '');
}

export function getAIConfig() {
  const baseUrl = process.env.AI_BASE_URL ? normalizeBaseUrl(process.env.AI_BASE_URL) : '';
  const apiKey = process.env.AI_API_KEY || '';
  const discovered = discoveredEnvironmentConfig?.baseUrl === baseUrl && discoveredEnvironmentConfig?.apiKey === apiKey
    ? discoveredEnvironmentConfig
    : null;
  return {
    baseUrl,
    apiKey,
    model: process.env.AI_MODEL || discovered?.model || '',
    models: discovered?.models || [],
    source: 'environment'
  };
}

export async function resolveAIConfig() {
  const config = getAIConfig();
  if (!config.baseUrl || !config.apiKey || config.model) return config;
  if (discoveredEnvironmentConfig?.baseUrl === config.baseUrl && discoveredEnvironmentConfig?.apiKey === config.apiKey) return { ...config, ...discoveredEnvironmentConfig };
  const models = await fetchModels(config);
  discoveredEnvironmentConfig = { baseUrl: config.baseUrl, apiKey: config.apiKey, model: models[0], models, source: 'environment' };
  return { ...config, ...discoveredEnvironmentConfig };
}

export async function resolveRequestAIConfig(body) {
  const provider = body?.aiProvider || 'platform';
  if (provider === 'platform') return resolveAIConfig();
  if (provider !== 'personal') throw fail('INVALID_AI_PROVIDER', 'AI 服务来源无效');
  const credentials = resolveCredentials(body.aiConfig);
  const model = typeof body.aiConfig?.model === 'string' ? body.aiConfig.model.trim() : '';
  if (!model || model.length > 256) throw fail('INVALID_MODEL', '个人 AI 配置不完整，请重新保存服务地址、密钥和模型');
  return { ...credentials, model, source: 'personal' };
}

export function getAIStatus() {
  const config = getAIConfig();
  return {
    aiConfigured: Boolean(config.baseUrl && config.apiKey && config.model),
    baseUrl: config.baseUrl,
    hasApiKey: Boolean(config.apiKey),
    model: config.model,
    models: config.models?.length ? config.models : config.model ? [config.model] : [],
    source: config.baseUrl || config.apiKey || config.model ? 'environment' : 'none'
  };
}

export function safeAIStatus(fallbackMessage = 'AI 服务配置无效') {
  try { return getAIStatus(); }
  catch (error) {
    return {
      aiConfigured: false,
      baseUrl: '',
      hasApiKey: Boolean(process.env.AI_API_KEY),
      model: '',
      models: [],
      source: 'environment',
      configurationError: { code: error.code || 'AI_CONFIG_ERROR', message: error.message || fallbackMessage },
    };
  }
}

export function resolveCredentials(body) {
  const baseUrl = normalizeBaseUrl(body?.baseUrl);
  if (body.apiKey !== undefined && typeof body.apiKey !== 'string') throw fail('INVALID_AI_KEY', 'API Key 格式无效');
  const apiKey = body.apiKey?.trim() || '';
  if (!apiKey || apiKey.length > 4096 || /\s/.test(apiKey)) throw fail('INVALID_AI_KEY', '请输入有效的 API Key；更换 URL 后需要重新填写');
  return { baseUrl, apiKey };
}

export async function fetchModels(config) {
  let response;
  try {
    response = await fetch(`${config.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.apiKey}` },
      signal: AbortSignal.timeout(15_000),
      redirect: 'error'
    });
  } catch (error) {
    throw error.name === 'TimeoutError'
      ? fail('AI_MODELS_TIMEOUT', '获取模型超时，请重试', 504)
      : fail('AI_MODELS_UNREACHABLE', '无法连接模型服务，请检查 URL 和网络', 502);
  }
  if (!response.ok) {
    const auth = [401, 403].includes(response.status);
    throw fail(auth ? 'AI_AUTH_FAILED' : 'AI_MODELS_UPSTREAM_ERROR', auth ? 'API Key 无效或没有访问权限' : response.status === 404 ? '模型列表接口不存在，请检查 URL 是否包含正确的 API 路径' : response.status === 429 ? '模型服务请求过于频繁，请稍后重试' : '模型服务暂时不可用，请重试', 502);
  }
  let data;
  try { data = await response.json(); } catch { throw fail('AI_MODELS_INVALID', '模型服务未返回有效的 JSON 模型列表', 502); }
  if (!Array.isArray(data.data)) throw fail('AI_MODELS_INVALID', '模型列表格式不兼容，需要 OpenAI 兼容的 /models 接口', 502);
  const models = [...new Set(data.data.map(item => typeof item?.id === 'string' ? item.id.trim() : '').filter(id => id && id.length <= 256))].sort();
  if (!models.length) throw fail('AI_MODELS_EMPTY', '该服务没有返回可用模型，请检查 Key 权限', 502);
  return models;
}
