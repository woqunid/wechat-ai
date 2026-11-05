import fs from 'node:fs';
import path from 'node:path';

const dateDirectory = /^\d{4}-\d{2}-\d{2}$/;
const imageExtension = /\.(?:jpe?g|png|webp)$/i;
const beijingDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' });

export const imageDateDirectory = (now = Date.now()) => beijingDate.format(new Date(now));

export function imageLifetime(days = process.env.ASSET_TTL_DAYS) {
  const value = Number(days);
  return (Number.isFinite(value) ? Math.max(30, value) : 30) * 86_400_000;
}

function* imageFiles(uploadDir) {
  for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
    if (entry.isFile() && imageExtension.test(entry.name)) yield entry.name;
    else if (entry.isDirectory() && dateDirectory.test(entry.name)) {
      for (const file of fs.readdirSync(path.join(uploadDir, entry.name), { withFileTypes: true })) {
        if (file.isFile() && imageExtension.test(file.name)) yield entry.name + '/' + file.name;
      }
    }
  }
}

export function findImageFiles(uploadDir, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return [];
  return [...imageFiles(uploadDir)].filter(filename => path.posix.basename(filename).startsWith(id + '.'));
}

export function cleanupExpiredAssets(uploadDir, now = Date.now()) {
  const lifetime = imageLifetime();
  for (const filename of imageFiles(uploadDir)) {
    const target = path.join(uploadDir, filename);
    try {
      if (now - fs.statSync(target).mtimeMs >= lifetime) fs.rmSync(target, { force: true });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !dateDirectory.test(entry.name)) continue;
    try { fs.rmdirSync(path.join(uploadDir, entry.name)); }
    catch (error) { if (!['ENOENT', 'ENOTEMPTY', 'EEXIST'].includes(error.code)) throw error; }
  }
}
