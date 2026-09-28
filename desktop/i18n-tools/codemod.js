#!/usr/bin/env node
// Wraps user-visible English strings in cvat-ui sources with t('...') from 'cvat-i18n'.
//
// Usage: node desktop/i18n-tools/codemod.js <file-or-dir>... [--dry]
// Prints a summary and writes a report of literals that need manual attention
// (string concatenation, HTML entities) to desktop/i18n-tools/manual-review.txt.

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const JSX_ATTRS = new Set([
    'title', 'placeholder', 'okText', 'cancelText', 'label', 'tooltip', 'description',
    'message', 'content', 'help', 'extra', 'alt', 'tab', 'header', 'addonBefore', 'addonAfter',
    'checkedChildren', 'unCheckedChildren', 'emptyText', 'buttonText', 'text', 'overlayTitle',
    'subTitle', 'okButtonText', 'confirmText', 'helpMessage', 'infoMessage', 'errorMessage',
    'overlay', 'tip', 'storageLabel', 'storageDescription', 'switchDescription', 'switchHelpMessage',
    'infoMappingLabel', 'deleteMappingLabel', 'tableTitle', 'loadingText',
]);
const OBJECT_PROPS = new Set([
    'message', 'description', 'title', 'content', 'okText', 'cancelText', 'label', 'tooltip',
    'placeholder', 'help', 'extra', 'emptyText', 'subTitle',
]);
const MESSAGE_CALLS = new Set(['success', 'error', 'info', 'warning', 'warn', 'loading']);
// variables/properties whose string values are shown to the user
const NAME_RE = /(title|text|message|label|tooltip|description|placeholder|content|hint|caption|details)$/i;
// calls whose string arguments are never user-visible text
const CALLEE_DENYLIST = /^(console\.|logger|log$|require$|import$|localStorage|sessionStorage|document\.|window\.|history\.|dispatch$|axios|Axios|fetch$|RegExp|JSON\.|Object\.|Array\.|Math\.|Number\.|String\.|parseInt|parseFloat|setTimeout|clearTimeout|t$|tr$|i18next|classNames|cn$|path\.|url|URL|new |.*\.(startsWith|endsWith|includes|indexOf|split|replace|match|test|join|get|has|set|getItem|setItem|removeItem|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|getAttribute|setAttribute|log|warn|debug)$)/;

// string or template literal that reads like a sentence (at least two words)
function isSentence(expr) {
    let text = null;
    if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) text = expr.text;
    else if (ts.isTemplateExpression(expr)) text = expr.head.text + expr.templateSpans.map((s) => s.literal.text).join(' ');
    return text !== null && /[A-Za-z]{2,}\s+[A-Za-z#]{1,}/.test(text) && isTranslatable(text);
}

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const inputs = args.filter((a) => !a.startsWith('--'));

function listFiles(p) {
    const stat = fs.statSync(p);
    if (stat.isFile()) return /\.(tsx?|jsx?)$/.test(p) && !/\.d\.ts$/.test(p) ? [p] : [];
    return fs.readdirSync(p).flatMap((f) => listFiles(path.join(p, f)));
}

function isTranslatable(s) {
    const text = s.trim();
    if (!/[A-Za-z]{2,}/.test(text)) return false;
    if (/^https?:\/\//.test(text)) return false;
    // CVAT's own {{placeholder}} templates (file names etc.) must stay literal
    if (text.includes('{{') || text.includes('}}')) return false;
    // css classes, keys, paths, identifiers: lowercase tokens without spaces
    if (/^[a-z0-9_\-./:#@*]+$/.test(text)) return false;
    // CONSTANT_NAMES
    if (/^[A-Z0-9_]+$/.test(text) && text.includes('_')) return false;
    // camelCase identifiers
    if (/^[a-z]+[A-Z][A-Za-z0-9]*$/.test(text)) return false;
    return true;
}

function normalizeJsxText(raw) {
    // JSX collapses multi-line text: lines are trimmed, empty ones dropped, joined with a space
    return raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join(' ');
}

function quote(s) {
    return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r/g, '\\r').replace(/\n/g, '\\n')}'`;
}

// multi-line template literals are only wrapped for source readability; HTML collapses the whitespace
function collapseLineBreaks(s) {
    return s.replace(/[ \t]*\r?\n\s*/g, ' ');
}

function processFile(file, report) {
    const source = fs.readFileSync(file, 'utf8');
    const kind = file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, kind);
    const edits = [];
    const keys = [];

    // choose a name for the translate function that does not clash with local identifiers
    let clash = false;
    (function findT(node) {
        if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node))
            && node.name && ts.isIdentifier(node.name) && node.name.text === 't') clash = true;
        ts.forEachChild(node, findT);
    }(sf));
    const fn = clash ? 'tr' : 't';

    const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    const isTCall = (node) => ts.isCallExpression(node) && ts.isIdentifier(node.expression)
        && (node.expression.text === 't' || node.expression.text === 'tr');

    function placeholderName(expr, used) {
        const exprText = expr.getText(sf);
        if (used.byExpr && used.byExpr.has(exprText)) return used.byExpr.get(exprText);
        if (!used.byExpr) used.byExpr = new Map();
        let name = 'value';
        if (ts.isIdentifier(expr)) name = expr.text;
        else if (ts.isPropertyAccessExpression(expr)) name = expr.name.text;
        let candidate = name;
        let i = 1;
        while (used.has(candidate)) candidate = `${name}${i++}`;
        used.add(candidate);
        used.byExpr.set(exprText, candidate);
        used.isNew = true;
        return candidate;
    }

    // Returns replacement text for an expression, or null if nothing to translate.
    function translateExpr(expr) {
        if (isTCall(expr)) return null;
        if (ts.isStringLiteral(expr) || ts.isNoSubstitutionTemplateLiteral(expr)) {
            if (!isTranslatable(expr.text)) return null;
            const key = ts.isNoSubstitutionTemplateLiteral(expr) ? collapseLineBreaks(expr.text) : expr.text;
            keys.push(key);
            return `${fn}(${quote(key)})`;
        }
        if (ts.isTemplateExpression(expr)) {
            const staticText = expr.head.text + expr.templateSpans.map((s) => s.literal.text).join('');
            if (!isTranslatable(staticText)) return null;
            const used = new Set();
            let key = collapseLineBreaks(expr.head.text);
            const opts = [];
            for (const span of expr.templateSpans) {
                used.isNew = false;
                const name = placeholderName(span.expression, used);
                key += `{{${name}}}${collapseLineBreaks(span.literal.text)}`;
                const exprText = span.expression.getText(sf);
                if (used.isNew) opts.push(exprText === name ? name : `${name}: ${exprText}`);
            }
            keys.push(key);
            return `${fn}(${quote(key)}, { ${opts.join(', ')} })`;
        }
        if (ts.isParenthesizedExpression(expr)) {
            const inner = translateExpr(expr.expression);
            return inner ? `(${inner})` : null;
        }
        if (ts.isConditionalExpression(expr)) {
            const a = translateExpr(expr.whenTrue);
            const b = translateExpr(expr.whenFalse);
            if (!a && !b) return null;
            return `${expr.condition.getText(sf)} ? ${a || expr.whenTrue.getText(sf)} : ${b || expr.whenFalse.getText(sf)}`;
        }
        if (ts.isBinaryExpression(expr)) {
            const op = expr.operatorToken.kind;
            if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
                const r = translateExpr(expr.right);
                return r ? `${expr.left.getText(sf)} ${expr.operatorToken.getText(sf)} ${r}` : null;
            }
            if (op === ts.SyntaxKind.PlusToken) {
                // 'a ' + `b ${x} ` + 'c' => t('a b {{x}} c', { x })
                const parts = [];
                (function flatten(e) {
                    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken) {
                        flatten(e.left);
                        flatten(e.right);
                    } else if (ts.isParenthesizedExpression(e)) {
                        flatten(e.expression);
                    } else {
                        parts.push(e);
                    }
                }(expr));
                const isLiteral = (e) => ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)
                    || ts.isTemplateExpression(e);
                if (!isLiteral(parts[0]) && !(parts.length > 1 && isLiteral(parts[1]))) return null;
                const staticText = parts.map((p) => {
                    if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) return p.text;
                    if (ts.isTemplateExpression(p)) return p.head.text + p.templateSpans.map((s) => s.literal.text).join('');
                    return '';
                }).join('');
                if (!isTranslatable(staticText)) return null;

                const used = new Set();
                const opts = [];
                const addPlaceholder = (e) => {
                    used.isNew = false;
                    const name = placeholderName(e, used);
                    const exprText = e.getText(sf);
                    if (used.isNew) opts.push(exprText === name ? name : `${name}: ${exprText}`);
                    return `{{${name}}}`;
                };
                let key = '';
                for (const p of parts) {
                    if (ts.isStringLiteral(p) || ts.isNoSubstitutionTemplateLiteral(p)) key += collapseLineBreaks(p.text);
                    else if (ts.isTemplateExpression(p)) {
                        key += collapseLineBreaks(p.head.text);
                        for (const span of p.templateSpans) {
                            key += addPlaceholder(span.expression) + collapseLineBreaks(span.literal.text);
                        }
                    } else key += addPlaceholder(p);
                }
                keys.push(key);
                return opts.length ? `${fn}(${quote(key)}, { ${opts.join(', ')} })` : `${fn}(${quote(key)})`;
            }
        }
        return null;
    }

    function replace(node, text) {
        edits.push({ start: node.getStart(sf), end: node.getEnd(), text });
    }

    function visit(node) {
        if (ts.isJsxText(node)) {
            const raw = node.getText(sf);
            const normalized = normalizeJsxText(raw);
            if (normalized && isTranslatable(normalized)) {
                if (/&[a-z#0-9]+;/i.test(normalized)) {
                    report.push(`${file}:${line(node)}: JSX text with HTML entity: ${normalized.slice(0, 120)}`);
                } else {
                    const lead = raw.match(/^\s*/)[0];
                    const trail = raw.match(/\s*$/)[0];
                    keys.push(normalized);
                    // keep a single space where the original inline text had one
                    const pre = lead && !lead.includes('\n') ? lead : '';
                    const post = trail && !trail.includes('\n') ? trail : '';
                    const startPos = node.getStart(sf) + lead.length;
                    const endPos = node.getEnd() - trail.length;
                    edits.push({
                        start: startPos - pre.length,
                        end: endPos + post.length,
                        text: `${pre ? "{' '}" : ''}{${fn}(${quote(normalized)})}${post ? "{' '}" : ''}`,
                    });
                }
            }
            return;
        }

        if (ts.isJsxAttribute(node) && node.initializer) {
            const name = node.name.getText(sf);
            if (JSX_ATTRS.has(name)) {
                const init = node.initializer;
                if (ts.isStringLiteral(init)) {
                    if (isTranslatable(init.text)) {
                        keys.push(init.text);
                        replace(init, `{${fn}(${quote(init.text)})}`);
                    }
                    return;
                }
                if (ts.isJsxExpression(init) && init.expression) {
                    const r = translateExpr(init.expression);
                    if (r) {
                        replace(init.expression, r);
                        return;
                    }
                }
            }
        }

        // {'text'} or {cond ? 'a' : 'b'} as JSX children
        if (ts.isJsxExpression(node) && node.expression && node.parent
            && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
            const r = translateExpr(node.expression);
            if (r) {
                replace(node.expression, r);
                return;
            }
        }

        // const tooltipTitle = cond ? 'Save the label and return' : '...';
        if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name)
            && NAME_RE.test(node.name.text)) {
            const r = translateExpr(node.initializer);
            if (r) {
                replace(node.initializer, r);
                return;
            }
        }

        // shortcut definitions: { name: 'Undo action', description: '...', sequences: [...] }
        const isShortcutName = ts.isPropertyAssignment(node) && node.name && node.name.getText(sf) === 'name'
            && ts.isObjectLiteralExpression(node.parent)
            && node.parent.properties.some((p) => p.name && ['sequences', 'nonActive'].includes(p.name.getText(sf)));
        if (ts.isPropertyAssignment(node) && node.name
            && (isShortcutName || OBJECT_PROPS.has(node.name.getText(sf).replace(/['"]/g, '')))) {
            const r = translateExpr(node.initializer);
            if (r) {
                replace(node.initializer, r);
                return;
            }
        }

        // message = `...`; this.title = '...';
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            && (ts.isIdentifier(node.left) || ts.isPropertyAccessExpression(node.left))
            && NAME_RE.test(ts.isIdentifier(node.left) ? node.left.text : node.left.name.text)) {
            const r = translateExpr(node.right);
            if (r) {
                replace(node.right, r);
                return;
            }
        }

        // (task, idx, total) => `Deleting task #${task.id}`
        if (ts.isArrowFunction(node) && !ts.isBlock(node.body) && isSentence(node.body)) {
            const r = translateExpr(node.body);
            if (r) replace(node.body, r);
        }

        // renderEllipsisText(`Started by ${user}`), title.push(`Group shapes ${key}`), setHelpMessage(...)
        if (ts.isCallExpression(node) && !CALLEE_DENYLIST.test(node.expression.getText(sf))) {
            for (const arg of node.arguments) {
                if (isSentence(arg)) {
                    const r = translateExpr(arg);
                    if (r) replace(arg, r);
                }
            }
        }

        // message.error('...'), antd `message` API
        if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'message'
            && MESSAGE_CALLS.has(node.expression.name.text) && node.arguments.length) {
            const r = translateExpr(node.arguments[0]);
            if (r) replace(node.arguments[0], r);
        }

        ts.forEachChild(node, visit);
    }
    visit(sf);

    if (!edits.length) return { changed: false, keys };

    // two rules may match the same literal (e.g. message.success(`...`)): keep the outermost edit
    edits.sort((a, b) => a.start - b.start || b.end - a.end);
    const accepted = [];
    for (const e of edits) {
        const last = accepted[accepted.length - 1];
        if (last && e.start < last.end) continue;
        accepted.push(e);
    }
    edits.length = 0;
    edits.push(...accepted.reverse());
    let out = source;
    for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

    const alreadyImported = /from 'cvat-i18n'/.test(source);
    if (!alreadyImported) {
        const importLine = `import { ${fn === 't' ? 't' : 't as tr'} } from 'cvat-i18n';\n`;
        const imports = sf.statements.filter((s) => ts.isImportDeclaration(s));
        if (imports.length) {
            const last = imports[imports.length - 1];
            // positions after edits shift only for edits located before this point; imports come first
            const pos = last.getEnd();
            out = `${out.slice(0, pos)}\n${importLine.trimEnd()}${out.slice(pos)}`;
        } else {
            const header = source.match(/^(\/\/.*\r?\n)*\r?\n?/)[0];
            out = header + importLine + out.slice(header.length);
        }
    }

    if (!dry) fs.writeFileSync(file, out);
    return { changed: true, keys };
}

const report = [];
const allKeys = new Set();
let changedFiles = 0;
for (const file of inputs.flatMap(listFiles)) {
    const { changed, keys } = processFile(file, report);
    if (changed) changedFiles++;
    keys.forEach((k) => allKeys.add(k));
}
fs.writeFileSync(path.join(__dirname, 'manual-review.txt'), `${report.join('\n')}\n`);
console.log(`files changed: ${changedFiles}, keys: ${allKeys.size}, manual review items: ${report.length}${dry ? ' (dry run)' : ''}`);
