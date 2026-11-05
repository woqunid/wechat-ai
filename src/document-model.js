import { DomUtils } from 'htmlparser2';
import { getTemplate } from './templates.js';
import { renderArticle } from './renderer.js';
import { articleWithHtml, escapeHtml, findHtmlNode, htmlElements, htmlTree, innerHtml, outerHtml, replaceHtmlNode } from './html-document.js';

function legacyHtml(article) {
  const html = renderArticle({ ...article, html: undefined }, getTemplate(article.templateId), new Map(), { mode: 'preview', editing: true }).html;
  const tree = htmlTree(html);
  for (const node of htmlElements(tree)) {
    const block = article.blocks.find(block => `block:${block.id}` === node.attribs['data-preview-key']);
    if (!block) continue;
    node.attribs['data-block-type'] = block.type;
    if (block.type === 'heading') node.attribs['data-heading-level'] = String(block.level);
    if (block.type === 'list') node.attribs['data-list-ordered'] = String(block.ordered);
  }
  if (!article.summary) {
    const summary = htmlElements(tree).find(node => node.attribs['data-preview-key'] === 'summary');
    if (summary) DomUtils.removeElement(summary);
  }
  for (const node of tree.children[0]?.children || []) if (node.type === 'tag' && !node.attribs['data-preview-key']) node.attribs['data-decoration'] = 'true';
  for (const node of htmlElements(tree)) {
    if (node.name !== 'img') continue;
    let parent = node;
    while (parent && !parent.attribs?.['data-preview-key']) parent = parent.parent;
    const block = article.blocks.find(block => `block:${block.id}` === parent?.attribs?.['data-preview-key']);
    if (block?.assetId) node.attribs['data-asset-id'] = block.assetId;
  }
  // Rendering without assets uses placeholders, so restore image elements at their semantic anchors.
  for (const block of article.blocks.filter(block => block.type === 'image' || block.type === 'imageCard')) {
    const anchor = htmlElements(tree).find(node => node.attribs['data-preview-key'] === `block:${block.id}`);
    if (!anchor || htmlElements(anchor).some(node => node.name === 'img')) continue;
    const placeholder = htmlElements(anchor).find(node => node.name === 'p' && innerHtml(node).includes('[图片待补充'));
    if (placeholder) {
      const image = htmlTree(`<img data-asset-id="${escapeHtml(block.assetId)}" alt="${escapeHtml(block.caption || block.title || '文章图片')}" style="display:block;width:100%;height:auto;">`).children[0];
      const index = placeholder.parent.children.indexOf(placeholder);
      placeholder.parent.children[index] = image;
      image.parent = placeholder.parent;
    }
  }
  return innerHtml(tree);
}

export function ensureHtmlArticle(article) {
  return article ? articleWithHtml(article, article.html || legacyHtml(article)) : article;
}

export function reconcileHtmlArticle(previous, next) {
  if (!next) return next;
  if (!previous?.html || !next.html || next.html !== previous.html) return ensureHtmlArticle(next);
  if (previous.blocks === next.blocks && previous.title === next.title && previous.summary === next.summary) return next;
  let html = next.html;
  const before = new Map(previous.blocks.map(block => [block.id, block]));
  const rendered = htmlTree(legacyHtml(next));
  const fresh = key => htmlElements(rendered).find(node => node.attribs['data-preview-key'] === key);
  const insertionNode = id => {
    let node = findHtmlNode(html, id);
    while (node?.parent?.attribs?.['data-block-type']) node = node.parent;
    return node;
  };
  for (const field of ['title', 'summary']) if (previous[field] !== next[field]) {
    const existing = htmlElements(htmlTree(html)).find(node => node.attribs['data-preview-key'] === field);
    if (existing && fresh(field)) html = replaceHtmlNode(html, existing.attribs['data-node-id'], outerHtml(fresh(field)));
  }
  for (const block of previous.blocks) if (!next.blocks.some(value => value.id === block.id)) {
    const existing = insertionNode(block.id);
    if (existing) html = replaceHtmlNode(html, existing.attribs['data-node-id'], '');
  }
  for (let index = 0; index < next.blocks.length; index++) {
    const block = next.blocks[index], old = before.get(block.id);
    if (JSON.stringify(old) === JSON.stringify(block)) continue;
    const existing = findHtmlNode(html, block.id);
    if (existing && old?.assetId && block.assetId) {
      existing.attribs['data-asset-id'] = block.assetId;
      html = replaceHtmlNode(html, block.id, outerHtml(existing));
    } else if (existing && fresh(`block:${block.id}`)) html = replaceHtmlNode(html, block.id, outerHtml(fresh(`block:${block.id}`)));
    else if (!old && fresh(`block:${block.id}`)) {
      const added = outerHtml(fresh(`block:${block.id}`));
      const after = next.blocks.slice(index + 1).map(block => insertionNode(block.id)).find(Boolean);
      const prior = next.blocks.slice(0, index).reverse().map(block => insertionNode(block.id)).find(Boolean);
      if (after) html = replaceHtmlNode(html, after.attribs['data-node-id'], added + outerHtml(after));
      else if (prior) html = replaceHtmlNode(html, prior.attribs['data-node-id'], outerHtml(prior) + added);
      else html += added;
    }
  }
  return articleWithHtml(next, html);
}
