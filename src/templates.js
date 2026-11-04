import data from './templates-data.json' with { type: 'json' };
export const templates = data;
export const getTemplate = (id) => templates.find(t=>t.id===id)||templates[0];

