/**
 * Collects every translatable string of the project and writes
 * `src/scripts/locales/zh-TW.js` (the reference table of the default locale).
 *
 * The interface is written in Traditional Chinese and `t()` falls back to the
 * key, so the reference table only has to exist for documentation: it is the
 * list a translator works from. Run it after changing any user visible string:
 *
 *   node scripts/extract-i18n-strings.mjs [output.json]
 *
 * Sources of strings:
 *   - every `t('…')` call in src/scripts (a literal argument is a key)
 *   - every `data-i18n` / `data-i18n-title` attribute in src/options.html
 *   - the labels, descriptions, question marks and snap points of
 *     src/scripts/libs/settings-config.js (they are translated where they are
 *     displayed, so they never appear as a `t('…')` literal in the sources)
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import * as acorn from 'acorn';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPTS = path.join(ROOT, 'src', 'scripts');
const JSON_OUT = process.argv[2] || path.join(os.tmpdir(), 'i18n-strings.json');

const keys = new Map(); // key -> where it came from
const dynamicKeys = new Map(); // non literal arguments of t()
const notFound = new Map();

const addKey = (key, where) => {
  if (typeof key !== 'string' || !key) return;
  if (!keys.has(key)) keys.set(key, where);
};

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === 'locales' ? [] : walk(full);
    return entry.name.endsWith('.js') ? [full] : [];
  });

// ---------------------------------------------------------------------------
// t('…') calls
// ---------------------------------------------------------------------------

for (const file of walk(SCRIPTS)) {
  // Rollup normalises CRLF to LF when it loads a module, so the strings that
  // end up in the bundle always use \n — match that here.
  const source = fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n');
  if (!source.includes('t(')) continue;

  const relative = path.relative(ROOT, file).replaceAll('\\', '/');
  const ast = acorn.parse(source, {
    ecmaVersion: 'latest',
    sourceType: 'module',
    locations: true,
  });

  const visit = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (
      node.type === 'CallExpression' &&
      node.callee.type === 'Identifier' &&
      node.callee.name === 't' &&
      node.arguments.length
    ) {
      const [first] = node.arguments;
      if (first.type === 'Literal' && typeof first.value === 'string') {
        addKey(first.value, `${relative}:${node.loc.start.line}`);
      } else if (first.type === 'TemplateLiteral' && !first.expressions.length) {
        // `t(`…`)` without interpolation is a literal key as well
        addKey(first.quasis[0].value.cooked, `${relative}:${node.loc.start.line}`);
      } else {
        const text = source.slice(first.start, first.end);
        if (!dynamicKeys.has(text)) dynamicKeys.set(text, `${relative}:${node.loc.start.line}`);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc') continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object' && value.type) visit(value);
    }
  };
  visit(ast);
}

// ---------------------------------------------------------------------------
// data-i18n attributes of the options page
// ---------------------------------------------------------------------------

const html = fs.readFileSync(path.join(ROOT, 'src', 'options.html'), 'utf8');
for (const match of html.matchAll(/data-i18n(?:-title)?="([^"]+)"/g)) {
  addKey(match[1], 'src/options.html');
}

// ---------------------------------------------------------------------------
// settings-config.js (labels, descriptions, question marks, snap points and the
// messages that are only assigned at runtime, e.g. `setting.disabled` when
// WebGL is turned off in the browser). Every string literal of that file that
// contains Chinese is user visible, so a source level scan is both simpler and
// more complete than walking the exported array (which depends on the browser
// capabilities detected at runtime).
// ---------------------------------------------------------------------------

const configPath = path.join(SCRIPTS, 'libs', 'settings-config.js');
const configSource = fs.readFileSync(configPath, 'utf8').replaceAll('\r\n', '\n');
const configAst = acorn.parse(configSource, {
  ecmaVersion: 'latest',
  sourceType: 'module',
  locations: true,
});

const hasCjk = /[\u3400-\u9fff\uf900-\ufaff]/;

// Property names of settings-config.js that hold user visible text. Snap point
// labels/hidden labels are covered by `label`/`hiddenLabel`, the message that
// is only assigned at runtime by `disabled`.
const TRANSLATABLE_PROPERTIES = new Set(['label', 'description', 'title', 'hiddenLabel', 'disabled']);

const visitConfig = (node) => {
  if (!node || typeof node.type !== 'string') return;

  if (node.type === 'ObjectExpression') {
    for (const property of node.properties) {
      if (property.type !== 'Property' || property.computed) continue;
      const name = property.key.name ?? property.key.value;
      if (typeof name !== 'string') continue;

      const value = property.value;
      if (TRANSLATABLE_PROPERTIES.has(name)) {
        if (value.type === 'Literal' && typeof value.value === 'string')
          addKey(value.value, `settings-config.js:${value.loc.start.line}`);
        else if (value.type === 'TemplateLiteral' && !value.expressions.length)
          addKey(
            value.quasis.map((quasi) => quasi.value.cooked).join(''),
            `settings-config.js:${value.loc.start.line}`
          );
      }
    }
  }

  // Safety net: any other Chinese string of that file is user visible too
  if (node.type === 'Literal' && typeof node.value === 'string' && hasCjk.test(node.value))
    addKey(node.value, `settings-config.js:${node.loc.start.line}`);

  for (const key of Object.keys(node)) {
    if (key === 'loc') continue;
    const value = node[key];
    if (Array.isArray(value)) value.forEach(visitConfig);
    else if (value && typeof value === 'object' && value.type) visitConfig(value);
  }
};
visitConfig(configAst);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const sorted = [...keys.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant'));
const object = {};
for (const key of sorted) object[key] = key;

const lines = sorted.map((key) => `  ${JSON.stringify(key)}: ${JSON.stringify(key)},`);

fs.writeFileSync(
  path.join(SCRIPTS, 'locales', 'zh-TW.js'),
  `/**
 * Traditional Chinese interface strings (the default locale).
 *
 * Generated by scripts/extract-i18n-strings.mjs — do not edit by hand.
 *
 * The keys are the source strings: the interface is written in Traditional
 * Chinese and \`t()\` falls back to the key, so a locale file only contains the
 * strings it actually translates. This file is the complete reference list.
 */
export default {
${lines.join('\n')}
};
`,
  'utf8'
);

fs.writeFileSync(JSON_OUT, `${JSON.stringify(object, null, 2)}\n`, 'utf8');

console.log('strings      :', sorted.length);
console.log('reference    : src/scripts/locales/zh-TW.js');
console.log('json         :', JSON_OUT);
if (dynamicKeys.size) {
  console.log('\nnon literal arguments of t() (must be looked up manually):');
  for (const [text, where] of dynamicKeys) console.log(`  ${where}  t(${text})`);
}
if (notFound.size) console.log('missing:', [...notFound.keys()].length);
