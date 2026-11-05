import { parseDocument } from 'htmlparser2';
import { contrastRatio } from './layout-design.js';

export function unreadableText(html) {
  const problems = new Map();
  const visit = (node, inherited) => {
    const resolved = { ...inherited };
    for (const declaration of (node.attribs?.style || '').split(';')) {
      const [property, value] = declaration.split(':').map(part => part.trim());
      if (['color', 'background-color'].includes(property) && /^#[a-f0-9]{6}$/i.test(value)) resolved[property] = value.toUpperCase();
    }
    resolved.key = node.attribs?.['data-preview-key'] || inherited.key;
    if (node.type === 'text' && node.data.trim() && contrastRatio(resolved.color, resolved['background-color']) < 4.5) {
      const key = JSON.stringify([resolved.key, node.data.trim(), resolved.color, resolved['background-color']]);
      problems.set(key, (problems.get(key) || 0) + 1);
    }
    for (const child of node.children || []) visit(child, resolved);
  };
  visit(parseDocument(html), { color: '#000000', 'background-color': '#FFFFFF', key: 'page' });
  return problems;
}
