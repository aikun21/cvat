#!/usr/bin/env node
// Merges desktop/i18n-tools/translations/zh-CN.*.json into cvat-ui/src/locales/zh-CN.json.
// Only keys that exist in the locale file (i.e. are used in code, see extract-keys.js) are filled.
// Validates that every {{placeholder}} of a key is kept in its translation.

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const LOCALE = path.join(ROOT, 'cvat-ui/src/locales/zh-CN.json');
const PARTS_DIR = path.join(__dirname, 'translations');

const locale = JSON.parse(fs.readFileSync(LOCALE, 'utf8'));
const parts = fs.readdirSync(PARTS_DIR).filter((f) => /^zh-CN\..+\.json$/.test(f)).sort();
const translations = {};
for (const f of parts) Object.assign(translations, JSON.parse(fs.readFileSync(path.join(PARTS_DIR, f), 'utf8')));

const placeholders = (s) => (s.match(/{{\s*[\w.]+\s*}}/g) || []).map((p) => p.replace(/\s/g, '')).sort();
const problems = [];
let filled = 0;
for (const key of Object.keys(locale)) {
    const value = translations[key];
    if (!value) continue;
    const expected = placeholders(key).filter((p, i, a) => a.indexOf(p) === i);
    const actual = placeholders(value).filter((p, i, a) => a.indexOf(p) === i);
    if (expected.join() !== actual.join()) {
        problems.push(`placeholder mismatch: ${JSON.stringify(key)} -> ${JSON.stringify(value)}`);
        continue;
    }
    locale[key] = value;
    filled++;
}
fs.writeFileSync(LOCALE, `${JSON.stringify(locale, null, 4)}\n`);

const missing = Object.keys(locale).filter((k) => !locale[k]);
const unusedTranslations = Object.keys(translations).filter((k) => !(k in locale));
console.log(`filled: ${filled}, still missing: ${missing.length}, translations for unused keys: ${unusedTranslations.length}`);
problems.forEach((p) => console.log(p));
missing.slice(0, 50).forEach((k) => console.log(`missing: ${JSON.stringify(k)}`));
