import crypto from 'node:crypto';
import { resolveRequestAIConfig } from './ai-config.js';
import { normalizeUsage, usageMeta } from './ai-usage.js';
import { sendError } from './http.js';

const resolvedApiStyles = new Map();
const modelResult = data => ({ text: data.output_text || data.choices?.[0]?.message?.content || data.output?.flatMap(item => item.content || []).find(item => item.type === 'output_text')?.text || '', usage: normalizeUsage(data.usage) });
export const parseModelJson = text => JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/, '$1'));

export const isUnsupportedVisionRequest = error => {
  const detail = `${error?.message || ''} ${error?.upstreamMessage || ''}`;
  return /(?:image|vision|multimodal|input_image|image_url).{0,100}(?:not supported|unsupported|not support|unavailable|disabled)|(?:not supported|unsupported|not support|unavailable|disabled).{0,100}(?:image|vision|multimodal|input_image|image_url)/i.test(detail);
};

const respondModelFailure = (res, error, signal, { code, message, timeoutMessage = message }) => {
  const timeout = signal.aborted || ['TimeoutError', 'AbortError'].includes(error?.name);
  const upstream = Boolean(error?.status);
  code = timeout ? 'AI_TIMEOUT' : error?.upstreamCode === 'model_price_error' ? 'AI_UPSTREAM_CONFIG_ERROR' : upstream ? 'AI_UPSTREAM_ERROR' : code;
  if (timeout) message = timeoutMessage;
  else if (code === 'AI_UPSTREAM_CONFIG_ERROR') message = '当前模型的上游计费配置错误，请联系 AI 服务商修复或切换模型';
  else if (upstream) message = `AI 服务请求失败（HTTP ${error.status}），请检查模型和服务配置`;
  else if (code === 'AI_EDIT_FAILED' && error?.name !== 'ZodError' && /\p{Script=Han}/u.test(error?.message || '')) message = `修改方案未通过检查（${error.message.slice(0, 300)}），原稿已保留，可调整要求后重试`;
  res.locals.modelFailure = { kind: timeout ? 'timeout' : upstream ? 'upstream' : 'validation', ...(error?.status ? { status: error.status } : {}), ...(error?.upstreamCode ? { upstreamCode: error.upstreamCode } : {}) };
  return sendError(res, timeout ? 504 : 502, code, message);
};

// 从尚未结束的模型 JSON 中取出 message 已生成的部分；模型规则要求 message 为首个字段。
export const partialMessage = text => {
  const body = /"message"\s*:\s*"((?:[^"\\]|\\.)*)/.exec(text.slice(0, 8000))?.[1];
  if (!body) return '';
  try { return JSON.parse(`"${body.replace(/\\u[0-9a-fA-F]{0,3}$/, '')}"`); } catch { return ''; }
};

const upstreamStreamError = detail => Object.assign(new Error('upstream stream error'), { status: 502, upstreamCode: detail?.code, upstreamMessage: String(detail?.message || '').slice(0, 2000) });

async function readEventStream(response, kind, onDelta) {
  const decoder = new TextDecoder();
  let buffer = '', text = '', usage;
  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.startsWith('data:') ? line.slice(5).trim() : '';
      if (!data || data === '[DONE]') continue;
      let event;
      try { event = JSON.parse(data); } catch { continue; }
      if (event.error || event.type === 'error' || event.type === 'response.failed') throw upstreamStreamError(event.error || event.response?.error || event);
      usage = event.usage || event.response?.usage || usage;
      if (event.type === 'response.completed' && !text) text = modelResult(event.response).text;
      const delta = kind === 'chat' ? event.choices?.[0]?.delta?.content : event.type === 'response.output_text.delta' ? event.delta : '';
      if (delta) { text += delta; onDelta(text); }
    }
  }
  return { text, usage: normalizeUsage(usage) };
}

const rejectMissingAIConfig = (res, config) => {
  if (config.baseUrl && config.apiKey && config.model) return false;
  const partial = Boolean(config.baseUrl || config.apiKey || config.model);
  sendError(res, 400, partial ? 'AI_CONFIG_INCOMPLETE' : 'AI_NOT_CONFIGURED', partial
    ? config.source === 'personal' ? '个人 AI 配置不完整，请重新保存' : '平台 AI 配置不完整，请检查部署环境变量'
    : '请先在 AI 设置中选择可用的 AI 服务');
  return true;
};

async function requestModel({ config, system, inputData, signal, imageInputs = [], onDelta }) {
  const base = config.baseUrl;
  const style = process.env.AI_API_STYLE || 'auto';
  const cacheKey = `${base}\0${crypto.createHash('sha256').update(config.apiKey).digest('hex')}\0${config.model}`;
  const resolvedApiStyle = resolvedApiStyles.get(cacheKey);
  const input = JSON.stringify(inputData);
  const imageUrl = image => `data:${image.mime};base64,${image.buffer.toString('base64')}`;
  const responsesUserContent = [{ type: 'input_text', text: input }, ...imageInputs.flatMap(image => [
    { type: 'input_text', text: image.label },
    { type: 'input_image', image_url: imageUrl(image) },
  ])];
  const chatUserContent = imageInputs.length ? [{ type: 'text', text: input }, ...imageInputs.flatMap(image => [
    { type: 'text', text: image.label },
    { type: 'image_url', image_url: { url: imageUrl(image) } },
  ])] : input;
  const responsesBody = { model: config.model, input: [{ role: 'system', content: [{ type: 'input_text', text: system }] }, { role: 'user', content: responsesUserContent }], text: { format: { type: 'json_object' } } };
  const chatBody = { model: config.model, temperature: 0.5, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: chatUserContent }] };
  const request = async (kind, body) => {
    const timeout = AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS || 90_000));
    return fetch(`${base}/${kind === 'responses' ? 'responses' : 'chat/completions'}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` }, body: JSON.stringify(onDelta ? { ...body, stream: true } : body), signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
  };
  const upstreamFailure = async response => {
    const upstreamMessage = (await response.text()).slice(0, 2000);
    let upstreamCode;
    try { upstreamCode = JSON.parse(upstreamMessage).error?.code; } catch { /* non-JSON upstream errors have no code */ }
    return Object.assign(new Error(`upstream ${response.status}`), { status: response.status, upstreamCode, upstreamMessage });
  };
  let kind = style === 'chat' || (style === 'auto' && resolvedApiStyle === 'chat') ? 'chat' : 'responses';
  let response = await request(kind, kind === 'chat' ? chatBody : responsesBody);
  if (!response.ok) {
    const error = await upstreamFailure(response);
    const unsupported = style !== 'responses' && kind === 'responses' && !isUnsupportedVisionRequest(error) && [400, 404, 405, 422].includes(error.status) && (/unsupported|not found|unknown|not support/i.test(error.upstreamMessage) || error.status === 404 || error.status === 405);
    if (!unsupported) throw error;
    kind = 'chat';
    response = await request(kind, chatBody);
    if (!response.ok) throw await upstreamFailure(response);
  }
  if (style === 'auto') resolvedApiStyles.set(cacheKey, kind);
  if (onDelta && response.headers.get('content-type')?.includes('text/event-stream')) return readEventStream(response, kind, onDelta);
  return modelResult(await response.json());
}

// 统一处理：AI 配置解析、客户端断开中止、最多两次尝试、用量统计与失败响应。
// attempt 返回响应函数表示完成；抛错则带着 lastError 重试；fallback 在两次尝试都未完成时兜底。
export async function runModelTask(req, res, { timeoutMs, attempt: tryOnce, fallback, failure, onDelta }) {
  const controller = new AbortController();
  res.once('close', () => { if (!res.writableEnded) controller.abort(); });
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
  let config;
  try { config = await resolveRequestAIConfig(req.body); }
  catch (error) { return sendError(res, error.status || 502, error.code || 'AI_CONFIG_ERROR', error.message || '无法连接 AI 服务'); }
  if (rejectMissingAIConfig(res, config)) return;
  const usages = res.locals.modelUsages = [];
  const meta = extra => ({ model: config.model, retried: usages.length > 1, ...extra, ...usageMeta(usages) });
  let lastError;
  for (let attempt = 0; attempt < 2 && !signal.aborted; attempt++) {
    usages.push(normalizeUsage());
    const request = async options => {
      const output = await requestModel({ config, signal, onDelta, ...options }).catch(error => {
        if (onDelta && error.status === 400 && /stream/i.test(error.upstreamMessage || '')) return requestModel({ config, signal, ...options });
        throw error;
      });
      usages[attempt] = output.usage;
      return output.text;
    };
    try {
      const respond = await tryOnce({ attempt, lastError, request });
      if (!respond) continue;
      if (!controller.signal.aborted) respond(meta);
      return;
    } catch (error) {
      if (controller.signal.aborted) return;
      lastError = error;
      if (error.status) break;
    }
  }
  if (controller.signal.aborted) return;
  const respond = fallback?.(lastError);
  if (respond) return respond(meta);
  return respondModelFailure(res, lastError, signal, failure);
}
