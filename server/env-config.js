import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const managedKeys = ['AI_BASE_URL', 'AI_API_KEY', 'AI_MODEL'];
const quoteEnvValue = value => {
  if (/^[^'"`][^\s#\r\n]*$/.test(value)) return value;
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"') && !/\\[nr]/.test(value)) return `"${value}"`;
  throw new Error('AI configuration contains characters that cannot be represented in .env');
};

export async function writePlatformAIConfig(filePath, values) {
  for (const key of managedKeys) {
    if (typeof values[key] !== 'string' || /[\0\r\n]/.test(values[key])) throw new Error('invalid config value');
  }

  let existing = '';
  let currentMode;
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('invalid config file');
    currentMode = stat.mode;
    existing = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const hadTrailingNewline = existing.endsWith('\n');
  const lines = existing ? existing.split(/\r?\n/) : [];
  if (hadTrailingNewline) lines.pop();
  const remaining = new Set(managedKeys);
  const managedLine = /^\s*(?:export\s+)?(AI_BASE_URL|AI_API_KEY|AI_MODEL)\s*=/;
  const updated = lines.map(line => {
    const match = line.match(managedLine);
    if (!match) return line;
    const key = match[1];
    remaining.delete(key);
    return `${key}=${quoteEnvValue(values[key])}`;
  });
  for (const key of remaining) updated.push(`${key}=${quoteEnvValue(values[key])}`);

  const content = `${updated.join(newline)}${newline}`;
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', mode: currentMode ? currentMode & 0o600 : 0o600, flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, currentMode ? currentMode & 0o600 : 0o600).catch(() => {});
  } catch (error) {
    await fs.unlink(temporaryPath).catch(() => {});
    throw error;
  }
}
