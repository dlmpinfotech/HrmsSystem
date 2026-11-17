#!/usr/bin/env node
/**
 * Verifies translation coverage:
 *  1. every static t('key') used in src/ exists in en.json
 *  2. every locale has exactly the same keys as en.json
 * Run: node scripts/check-i18n.mjs   (also enforced by tests/unit/i18n.test.ts)
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const localesDir = path.join(root, 'src/i18n/locales');

export function flatten(obj, prefix = '', out = new Map()) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out.set(key, Array.isArray(v) ? 'array' : typeof v);
  }
  return out;
}

function walk(dir, files = []) {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (/\.(tsx?|ts)$/.test(f)) files.push(p);
  }
  return files;
}

export function usedKeys(srcDir) {
  const keys = new Set();
  // t('a.b') / t("a.b") / i18nKey literal; template literals with ${} are dynamic and skipped.
  const re = /\bt\(\s*['"]([a-zA-Z0-9_.]+)['"]/g;
  for (const file of walk(srcDir)) {
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(re)) keys.add(m[1]);
  }
  return keys;
}

export function check() {
  const en = flatten(JSON.parse(readFileSync(path.join(localesDir, 'en.json'), 'utf8')));
  const problems = [];
  const enKeys = new Set(en.keys());
  const hasPrefix = (k) => enKeys.has(k) || [...enKeys].some((e) => e.startsWith(`${k}.`));
  for (const k of usedKeys(path.join(root, 'src'))) if (!hasPrefix(k)) problems.push(`missing in en.json: ${k}`);
  for (const file of readdirSync(localesDir).filter((f) => f.endsWith('.json') && f !== 'en.json')) {
    const other = flatten(JSON.parse(readFileSync(path.join(localesDir, file), 'utf8')));
    for (const k of en.keys()) if (!other.has(k)) problems.push(`${file} missing: ${k}`);
    for (const k of other.keys()) if (!en.has(k)) problems.push(`${file} has extra key: ${k}`);
    for (const [k, type] of en) if (other.has(k) && other.get(k) !== type) problems.push(`${file} type mismatch: ${k}`);
  }
  return problems;
}

if (process.argv[1] && process.argv[1].endsWith('check-i18n.mjs')) {
  const problems = check();
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n${problems.length} problem(s)`);
    process.exit(1);
  }
  console.log('i18n OK');
}
