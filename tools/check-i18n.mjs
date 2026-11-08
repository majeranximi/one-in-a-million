// Checks that every language has the same keys and placeholders as English,
// and that every key the code and page use exists.
import fs from 'node:fs';
import { STRINGS, LANGS, BOT_NAMES } from '../src/i18n.js';
import { ACHIEVEMENTS, SKINS, UPGRADES } from '../src/progress.js';

const base = STRINGS.en;
const keys = Object.keys(base);
const params = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
let errors = 0;
const fail = (msg) => { errors++; console.log('ERROR', msg); };

for (const { code } of LANGS) {
  const s = STRINGS[code];
  for (const k of keys) {
    if (!(k in s)) fail(`${code}: missing ${k}`);
    else if (params(s[k]) !== params(base[k])) fail(`${code}: placeholders differ in ${k}`);
  }
  for (const k of Object.keys(s)) if (!(k in base)) fail(`${code}: unknown key ${k}`);
  if (BOT_NAMES[code]?.length !== BOT_NAMES.en.length) fail(`${code}: bot name count`);
}

const sources = ['src/main.js', 'src/online.js', 'src/lab.js', 'src/page.html'].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
const used = new Set([...sources.matchAll(/\bt\('([\w.]+)'|data-i18n(?:-aria|-title)?="([\w.]+)"/g)].map((m) => m[1] || m[2]));
for (const a of ACHIEVEMENTS) used.add(`ach.${a.id}`).add(`ach.${a.id}.d`);
for (const s of SKINS) used.add(`skin.${s.id}`);
for (const u of UPGRADES) used.add(`up.${u.id}`).add(`up.${u.id}.d`);
for (const k of used) if (!(k in base)) fail(`used but not translated: ${k}`);

console.log(`${LANGS.length} languages, ${keys.length} keys each, ${errors} errors`);
process.exitCode = errors ? 1 : 0;
