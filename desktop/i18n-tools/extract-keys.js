#!/usr/bin/env node
// Collects every t('...') key used in cvat-ui/src and syncs cvat-ui/src/locales/zh-CN.json:
// existing translations are kept, new keys are added with an empty value, unused keys are dropped
// (use --keep-unused to keep them). Prints the number of untranslated keys.
//
// Usage: node desktop/i18n-tools/extract-keys.js [--keep-unused] [--missing <out.json>]

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'cvat-ui/src');
const LOCALE = path.join(SRC, 'locales/zh-CN.json');
const args = process.argv.slice(2);
const keepUnused = args.includes('--keep-unused');
const missingOut = args.includes('--missing') ? args[args.indexOf('--missing') + 1] : null;

function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) return listFiles(p);
        return /\.(tsx?)$/.test(e.name) && !e.name.endsWith('.d.ts') ? [p] : [];
    });
}

const keys = new Map(); // key -> first location
for (const file of listFiles(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    if (!source.includes('cvat-i18n')) continue;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
        file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    (function visit(node) {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
            && ['t', 'tr'].includes(node.expression.text) && node.arguments.length
            && (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))) {
            const key = node.arguments[0].text;
            if (!keys.has(key)) {
                const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
                keys.set(key, `${path.relative(SRC, file).replace(/\\/g, '/')}:${line + 1}`);
            }
        }
        ts.forEachChild(node, visit);
    }(sf));
}

const existing = fs.existsSync(LOCALE) ? JSON.parse(fs.readFileSync(LOCALE, 'utf8')) : {};
const result = {};
const sortedKeys = [...keys.keys()].sort((a, b) => a.localeCompare(b));
for (const k of sortedKeys) result[k] = existing[k] || '';
if (keepUnused) for (const [k, v] of Object.entries(existing)) if (!(k in result)) result[k] = v;
fs.writeFileSync(LOCALE, `${JSON.stringify(result, null, 4)}\n`);

const missing = sortedKeys.filter((k) => !result[k]);
if (missingOut) {
    fs.writeFileSync(missingOut, JSON.stringify(Object.fromEntries(missing.map((k) => [k, keys.get(k)])), null, 2));
}
const unused = Object.keys(existing).filter((k) => !keys.has(k));
console.log(`keys: ${sortedKeys.length}, translated: ${sortedKeys.length - missing.length}, missing: ${missing.length}, unused dropped: ${keepUnused ? 0 : unused.length}`);
