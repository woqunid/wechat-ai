import { useEffect, useState } from "react";
import { Building2, Check, KeyRound, LoaderCircle, RefreshCw, Save, Trash2, UserRound } from "lucide-react";
import { postJson } from "./api.js";
import { Modal } from "./Modal.jsx";

export function AIServiceSettings({ open, onClose, platformStatus, preferences, onPreferencesChange }) {
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const provider = preferences.provider;
  const personalConfig = preferences.personalConfig;

  useEffect(() => {
    if (!open) return;
    setBaseUrl(personalConfig?.baseUrl || "");
    setApiKey(personalConfig?.apiKey || "");
    setModels(personalConfig?.models || []);
    setModel(personalConfig?.model || "");
    setError("");
    setNotice("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!open) return null;

  const selectProvider = next => {
    setError("");
    setNotice("");
    onPreferencesChange({ ...preferences, provider: next });
  };
  const updateBaseUrl = value => {
    setBaseUrl(value);
    setModels([]);
    setModel("");
    setError("");
    setNotice("");
  };
  const updateApiKey = value => {
    setApiKey(value);
    setModels([]);
    setModel("");
    setError("");
    setNotice("");
  };
  const fetchModelList = async () => {
    setBusy("models");
    setError("");
    setNotice("");
    try {
      const data = await postJson("/api/config/models", { baseUrl, apiKey }, { fallback: "AI 服务请求失败" });
      setBaseUrl(data.baseUrl);
      setModels(data.models);
      setModel(current => data.models.includes(current) ? current : data.models[0]);
    } catch (cause) {
      setModels([]);
      setModel("");
      setError(cause.message || "获取模型失败，请重试");
    } finally {
      setBusy("");
    }
  };
  const savePersonal = () => {
    if (!models.includes(model)) return;
    const next = {
      provider: "personal",
      personalConfig: { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model, models },
    };
    try {
      onPreferencesChange(next);
      setNotice("个人配置已保存在本机浏览器");
    } catch (cause) {
      setError(cause.message || "无法保存到本机浏览器");
    }
  };
  const clearPersonal = () => {
    try {
      onPreferencesChange({ provider: "platform", personalConfig: null });
      setBaseUrl("");
      setApiKey("");
      setModels([]);
      setModel("");
      setNotice("个人配置已删除");
      setError("");
    } catch (cause) {
      setError(cause.message || "无法删除本机配置");
    }
  };
  const loading = Boolean(busy);

  return (
    <Modal className="ai-settings-modal" backdropClassName="ai-settings-backdrop" aria-labelledby="ai-settings-title" onClose={onClose} closeLabel="关闭 AI 服务设置">
        <h2 id="ai-settings-title">AI 服务</h2>
        <div className="segmented ai-provider-switch" role="group" aria-label="AI 服务来源">
          <button type="button" className={`ai-provider-option ${provider === "platform" ? "selected" : ""}`} aria-pressed={provider === "platform"} onClick={() => selectProvider("platform")}>
            <Building2 size={16} /><span className="ai-provider-info"><strong>平台 AI</strong><small>{provider === "platform" ? "正在使用" : platformStatus?.aiConfigured ? "已连接" : "未配置"}</small></span>
            {provider === "platform" && <Check className="ai-provider-check" size={16} aria-hidden="true" />}
          </button>
          <button type="button" className={`ai-provider-option ${provider === "personal" ? "selected" : ""}`} aria-pressed={provider === "personal"} onClick={() => selectProvider("personal")}>
            <UserRound size={16} /><span className="ai-provider-info"><strong>个人 AI</strong><small>{provider === "personal" ? "正在使用" : personalConfig ? "已保存" : "待配置"}</small></span>
            {provider === "personal" && <Check className="ai-provider-check" size={16} aria-hidden="true" />}
          </button>
        </div>

        {provider === "platform" ? (
          <div className="ai-settings-field ai-platform-status">
            <span>平台服务</span>
            <strong>{platformStatus?.aiConfigured ? platformStatus.model : "尚未配置"}</strong>
            <small className="ai-field-hint">由部署方维护，选择平台 AI 的用户共用。</small>
            {platformStatus?.configurationError && <small className="ai-settings-message error" role="alert">{platformStatus.configurationError.message}</small>}
          </div>
        ) : (
          <>
            <p className="ai-settings-intro personal-ai-note">配置仅保存在此浏览器；请求由本服务转发。</p>
            <label className="ai-settings-field">
              <span>接口地址</span>
              <input value={baseUrl} onChange={event => updateBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="url" spellCheck="false" />
            </label>
            <label className="ai-settings-field">
              <span><KeyRound size={13} /> API Key</span>
              <input type="password" value={apiKey} onChange={event => updateApiKey(event.target.value)} placeholder="输入个人服务密钥" autoComplete="new-password" />
            </label>
            <div className="ai-settings-field">
              <label htmlFor="ai-model-select">模型</label>
              <div className="model-select-row">
                <select id="ai-model-select" value={model} onChange={event => setModel(event.target.value)} disabled={!models.length || loading}>
                  {!models.length && <option value="">先获取模型列表</option>}
                  {models.map(item => <option value={item} key={item}>{item}</option>)}
                </select>
                <button className="icon-action" type="button" title="获取模型列表" aria-label="获取模型列表" disabled={loading || !baseUrl.trim() || !apiKey.trim()} onClick={fetchModelList}>
                  {busy === "models" ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}
                </button>
              </div>
              <small className="ai-field-hint">支持 OpenAI 兼容接口；仅支持 HTTPS 公网地址。</small>
            </div>
          </>
        )}

        {(error || notice) && <p className={`ai-settings-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || notice}</p>}
        <div className="ai-settings-footer">
          <span>{provider === "platform" ? platformStatus?.aiConfigured ? `平台模型：${platformStatus.model}` : "平台 AI 未连接" : personalConfig ? `个人模型：${personalConfig.model}` : "未保存个人配置"}</span>
          {provider === "personal" && <div className="ai-settings-actions">
            {personalConfig && <button className="ghost-action" type="button" title="删除个人配置" disabled={loading} onClick={clearPersonal}><Trash2 size={14} />删除配置</button>}
            <button className="publish-action" type="button" disabled={loading || !model || !models.includes(model) || !apiKey.trim()} onClick={savePersonal}>
              <Save size={14} />保存并使用
            </button>
          </div>}
        </div>
    </Modal>
  );
}
