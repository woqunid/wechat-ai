import { useEffect, useState } from 'react';
import { Home, KeyRound, LoaderCircle, RefreshCw, Save } from 'lucide-react';
import { requestJson } from './api.js';

const request = (path, options = {}) => requestJson(`/api/admin${path}`, {
  ...options,
  credentials: 'same-origin',
  headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
});

export function AdminPage() {
  const [access, setAccess] = useState('checking');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [savedBaseUrl, setSavedBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [model, setModel] = useState('');
  const [models, setModels] = useState([]);
  const [message, setMessage] = useState(null);

  const applyConfig = config => {
    setBaseUrl(config.baseUrl || '');
    setSavedBaseUrl(config.baseUrl || '');
    setHasApiKey(Boolean(config.hasApiKey));
    setModel(config.model || '');
    setModels(config.models?.length ? config.models : config.model ? [config.model] : []);
    if (config.configurationError) setMessage({ type: 'error', text: config.configurationError.message });
  };

  const loadConfig = async () => applyConfig(await request('/config'));

  useEffect(() => {
    let active = true;
    request('/session')
      .then(() => request('/config'))
      .then(config => { if (active) { applyConfig(config); setAccess('authenticated'); } })
      .catch(error => {
        if (!active) return;
        if (error.code === 'ADMIN_AUTH_NOT_CONFIGURED') setAccess('unconfigured');
        else if (error.status === 401) setAccess('locked');
        else { setAccess('locked'); setMessage({ type: 'error', text: error.message }); }
      });
    return () => { active = false; };
  }, []);

  const login = async event => {
    event.preventDefault();
    setBusy('login');
    setMessage(null);
    try {
      await request('/login', { method: 'POST', body: JSON.stringify({ password }) });
      setPassword('');
      await loadConfig();
      setAccess('authenticated');
    } catch (error) {
      if (error.code === 'ADMIN_AUTH_NOT_CONFIGURED') setAccess('unconfigured');
      setMessage({ type: 'error', text: error.message });
    } finally { setBusy(''); }
  };

  const fetchModels = async () => {
    setBusy('models');
    setMessage(null);
    try {
      const result = await request('/models', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey }) });
      setModels(result.models);
      setModel(current => result.models.includes(current) ? current : result.models[0] || '');
      setMessage({ type: 'success', text: `已获取 ${result.models.length} 个模型` });
    } catch (error) {
      if (error.status === 401) setAccess('locked');
      else setMessage({ type: 'error', text: error.message });
    }
    finally { setBusy(''); }
  };

  const saveConfig = async event => {
    event.preventDefault();
    setBusy('save');
    setMessage(null);
    try {
      const result = await request('/config', { method: 'POST', body: JSON.stringify({ baseUrl, apiKey, model }) });
      applyConfig(result);
      setApiKey('');
      setMessage({ type: 'success', text: '平台 AI 配置已保存' });
    } catch (error) {
      if (error.status === 401) setAccess('locked');
      else setMessage({ type: 'error', text: error.message });
    }
    finally { setBusy(''); }
  };

  const keyCanBeReused = hasApiKey && baseUrl.trim() === savedBaseUrl;

  return (
    <div className="admin-shell">
      <header className="admin-brandbar">
        <a className="wordmark admin-wordmark" href="/" aria-label="返回 Weave 工作台">
          <span className="mark">W</span><span><strong>Weave</strong><small>内容工作台</small></span>
        </a>
        <div className="admin-header-actions">
          <a className="ghost-action admin-home-action" href="/" title="返回首页">
            <Home size={15}/><span>返回首页</span>
          </a>
        </div>
      </header>

      <main className={`admin-main ${access === 'authenticated' ? '' : 'admin-main-compact'}`}>
        {access === 'checking' ? <div className="admin-loading"><LoaderCircle className="spin" size={20}/></div> : null}
        {access === 'unconfigured' ? (
          <section className="admin-login-surface">
            <div className="admin-title-row"><KeyRound size={18}/><h1>管理访问未启用</h1></div>
            <p className="admin-auth-hint">请在服务器设置 <code>BAOLONG_ADMIN_PASSWORD</code>。</p>
          </section>
        ) : null}
        {access === 'locked' ? (
          <section className="admin-login-surface">
            <div className="admin-title-row"><KeyRound size={18}/><h1>管理登录</h1></div>
            <form onSubmit={login}>
              <label className="admin-field">
                <span>访问密码</span>
                <input type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" autoFocus required />
              </label>
              {message && <p className={`ai-settings-message ${message.type}`} role="alert">{message.text}</p>}
              <button className="publish-action admin-submit" type="submit" disabled={busy === 'login' || !password}>
                {busy === 'login' ? <LoaderCircle className="spin" size={15}/> : <KeyRound size={15}/>}进入管理
              </button>
            </form>
          </section>
        ) : null}
        {access === 'authenticated' ? (
          <>
            <div className="admin-title-row admin-page-title">
              <div><span className="eyebrow">PLATFORM</span><h1>平台 AI</h1></div>
              <span className={`admin-status ${baseUrl.trim() && hasApiKey && model && baseUrl.trim() === savedBaseUrl ? 'connected' : ''}`}><i/>{baseUrl.trim() && hasApiKey && model && baseUrl.trim() === savedBaseUrl ? '已连接' : '未配置'}</span>
            </div>
            <form className="admin-config-form" onSubmit={saveConfig}>
              <label className="admin-field">
                <span>服务地址</span>
                <input type="url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="url" required />
              </label>
              <label className="admin-field">
                <span>API Key</span>
                <input type="password" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder={hasApiKey ? '已配置，留空以保留当前密钥' : '输入服务密钥'} autoComplete="new-password" />
              </label>
              <div className="admin-field">
                <label htmlFor="admin-model">模型</label>
                <div className="model-select-row">
                  <select id="admin-model" value={model} onChange={event => setModel(event.target.value)} disabled={!models.length || busy !== ''} required>
                    {!models.length && <option value="">获取模型列表</option>}
                    {models.map(item => <option value={item} key={item}>{item}</option>)}
                  </select>
                  <button className="icon-action" type="button" title="获取模型列表" aria-label="获取模型列表" disabled={busy !== '' || !baseUrl.trim() || (!apiKey.trim() && !keyCanBeReused)} onClick={fetchModels}>
                    {busy === 'models' ? <LoaderCircle className="spin" size={15}/> : <RefreshCw size={15}/>}
                  </button>
                </div>
              </div>
              {message && <p className={`ai-settings-message ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}
              <div className="admin-form-footer">
                <span>{hasApiKey ? '密钥已保存' : '尚未保存密钥'}</span>
                <button className="publish-action" type="submit" disabled={busy !== '' || !baseUrl.trim() || !model || (!apiKey.trim() && !keyCanBeReused)}>
                  {busy === 'save' ? <LoaderCircle className="spin" size={15}/> : <Save size={15}/>}保存配置
                </button>
              </div>
            </form>
          </>
        ) : null}
      </main>
    </div>
  );
}
