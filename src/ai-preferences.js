const STORAGE_KEY = 'weave-ai-preferences';

export function isPersonalAIConfigured(config) {
  return [config?.baseUrl, config?.apiKey, config?.model].every(value => typeof value === 'string' && value.trim());
}

function normalizePersonalConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;
  const fields = ['baseUrl', 'apiKey', 'model'];
  if (!fields.every(field => typeof config[field] === 'string')) return null;
  return {
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    models: Array.isArray(config.models) ? config.models.filter(item => typeof item === 'string') : [],
  };
}

export function loadAIPreferences() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    const personalConfig = normalizePersonalConfig(value.personalConfig);
    return {
      provider: value.provider === 'personal' && isPersonalAIConfigured(personalConfig) ? 'personal' : 'platform',
      personalConfig,
    };
  } catch {
    return { provider: 'platform', personalConfig: null };
  }
}

export function saveAIPreferences(preferences) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

export function selectedAIIsReady(preferences, platformStatus) {
  return preferences.provider === 'personal'
    ? isPersonalAIConfigured(preferences.personalConfig)
    : Boolean(platformStatus?.aiConfigured);
}

export function aiRequestOptions(preferences) {
  if (preferences.provider === 'personal') {
    const { baseUrl, apiKey, model } = preferences.personalConfig || {};
    return { aiProvider: 'personal', aiConfig: { baseUrl, apiKey, model } };
  }
  return { aiProvider: 'platform' };
}
