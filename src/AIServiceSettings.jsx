import { useEffect, useState } from "react";
import { KeyRound, LoaderCircle, RefreshCw, Save, X } from "lucide-react";

async function readResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error?.message || "AI 服务请求失败");
  return data;
}

export function AIServiceSettings({ open, onClose, onStatusChange }) {
  const [status, setStatus] = useState(null);
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!open) {
      setApiKey("");
      return;
    }
    let active = true;
    setBusy("status");
    setError("");
    fetch("/api/config/status")
      .then(readResponse)
      .then((data) => {
        if (!active) return;
        setStatus(data);
        setBaseUrl(data.baseUrl || "");
        setModels(data.models || []);
        setModel(data.model || data.models?.[0] || "");
        setError(data.configurationError?.message || "");
        onStatusChange?.(data);
      })
      .catch((cause) => {
        if (active) setError(cause.message || "无法读取 AI 服务状态");
      })
      .finally(() => active && setBusy(""));
    return () => {
      active = false;
    };
  }, [open, onStatusChange]);

  if (!open) return null;

  const updateBaseUrl = (value) => {
    setBaseUrl(value);
    setModels([]);
    setModel("");
    setError("");
    setNotice("");
  };
  const updateApiKey = (value) => {
    setApiKey(value);
    setModels([]);
    setModel("");
    setError("");
    setNotice("");
  };
  const requestBody = () => ({
    baseUrl,
    ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
  });
  const fetchModelList = async () => {
    setBusy("models");
    setError("");
    setNotice("");
    try {
      const data = await readResponse(
        await fetch("/api/config/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(requestBody()),
        }),
      );
      setModels(data.models);
      setModel((current) =>
        data.models.includes(current)
          ? current
          : data.models.includes(status?.model)
            ? status.model
            : data.models[0],
      );
      setError("");
    } catch (cause) {
      setModels([]);
      setModel("");
      setError(cause.message || "获取模型失败，请重试");
    } finally {
      setBusy("");
    }
  };
  const save = async () => {
    setBusy("save");
    setError("");
    setNotice("");
    try {
      const data = await readResponse(
        await fetch("/api/config/ai", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...requestBody(), model }),
        }),
      );
      setStatus(data);
      setBaseUrl(data.baseUrl || "");
      setApiKey("");
      setModels(data.models || []);
      setModel(data.model || "");
      setNotice("配置已保存");
      onStatusChange?.(data);
    } catch (cause) {
      setError(cause.message || "保存失败，请重试");
    } finally {
      setBusy("");
    }
  };
  const reset = async () => {
    setBusy("reset");
    setError("");
    setNotice("");
    try {
      const data = await readResponse(
        await fetch("/api/config/ai", { method: "DELETE" }),
      );
      setStatus(data);
      setBaseUrl(data.baseUrl || "");
      setApiKey("");
      setModels(data.models || []);
      setModel(data.model || "");
      setError(data.configurationError?.message || "");
      setNotice("已恢复服务端环境配置");
      onStatusChange?.(data);
    } catch (cause) {
      setError(cause.message || "恢复环境配置失败");
    } finally {
      setBusy("");
    }
  };
  const loading = Boolean(busy);
  const sameUrl = baseUrl.trim() === status?.baseUrl;

  return (
    <div className="modal-backdrop ai-settings-backdrop" onClick={onClose}>
      <section
        className="small-modal ai-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="modal-close"
          aria-label="关闭 AI 服务设置"
          onClick={onClose}
        >
          <X size={18} />
        </button>
        <span className="eyebrow">模型连接</span>
        <h2 id="ai-settings-title">AI 服务</h2>
        <p className="ai-settings-intro">
          使用 OpenAI 兼容接口。密钥只发送到本服务端，不会保存在浏览器。
        </p>
        <label className="ai-settings-field">
          <span>服务 URL</span>
          <input
            value={baseUrl}
            onChange={(event) => updateBaseUrl(event.target.value)}
            placeholder="https://api.example.com/v1"
            autoComplete="url"
            spellCheck="false"
          />
        </label>
        <label className="ai-settings-field">
          <span>
            <KeyRound size={13} /> API Key
            {status?.hasApiKey && sameUrl && (
              <small className="key-saved">已保存，留空沿用</small>
            )}
          </span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => updateApiKey(event.target.value)}
            placeholder={
              status?.hasApiKey && sameUrl ? "输入新密钥以更换" : "输入服务密钥"
            }
            autoComplete="new-password"
          />
        </label>
        <div className="ai-settings-field">
          <label htmlFor="ai-model-select">模型</label>
          <div className="model-select-row">
            <select
              id="ai-model-select"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={!models.length || loading}
            >
              {!models.length && <option value="">先获取模型列表</option>}
              {models.map((item) => (
                <option value={item} key={item}>
                  {item}
                </option>
              ))}
            </select>
            <button
              className="icon-action"
              type="button"
              title="获取模型列表"
              aria-label="获取模型列表"
              disabled={loading || !baseUrl.trim()}
              onClick={fetchModelList}
            >
              {busy === "models" ? (
                <LoaderCircle className="spin" size={15} />
              ) : (
                <RefreshCw size={15} />
              )}
            </button>
          </div>
          <small className="ai-field-hint">
            支持 API 根路径或完整的 /models、/responses、/chat/completions 地址
          </small>
        </div>
        {(error || notice) && (
          <p
            className={
              error
                ? "ai-settings-message error"
                : "ai-settings-message success"
            }
            role={error ? "alert" : "status"}
          >
            {error || notice}
          </p>
        )}
        <div className="ai-settings-footer">
          <span>
            {busy === "status"
              ? "读取配置中"
              : status?.aiConfigured
                ? `当前模型：${status.model}`
                : "未配置时使用本地示例内容"}
          </span>
          <div className="ai-settings-actions">
            {status?.source === "custom" && (
              <button
                className="ghost-action"
                type="button"
                disabled={loading}
                onClick={reset}
              >
                恢复环境配置
              </button>
            )}
            <button
              className="publish-action"
              type="button"
              disabled={loading || !model || !models.includes(model)}
              onClick={save}
            >
              {busy === "save" ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Save size={14} />
              )}
              保存配置
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
