import { isImageBlock } from './ai-edit.js';

const DAY = 86_400_000;
const WARNING_DAYS = 3;

export const assetExpired = (asset, now = Date.now()) => !asset || asset.pasteStatus === 'broken' || Date.parse(asset.expiresAt) <= now;

export function imageExpiry(article, assets, now = Date.now()) {
  const expired = [], expiring = [];
  for (const id of new Set(article.blocks.filter(isImageBlock).map(block => block.assetId).filter(Boolean))) {
    const asset = assets.get(id);
    if (assetExpired(asset, now)) expired.push(id);
    else if (Date.parse(asset.expiresAt) - now < WARNING_DAYS * DAY) expiring.push(id);
  }
  const soonest = Math.min(...expiring.map(id => Date.parse(assets.get(id).expiresAt)));
  return { expired, expiring, days: expiring.length ? Math.ceil((soonest - now) / DAY) : 0, restorable: [...expired, ...expiring].filter(id => assets.get(id)?.blob) };
}
