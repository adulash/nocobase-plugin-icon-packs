/**
 * Builds the distributable plugin from src/ + packs/.
 *
 * No bundler, no toolchain: NocoBase loads a plugin's client entry as a UMD module with
 * a NAMED AMD define and externals. That is a shape we can emit directly, which keeps
 * this repo buildable with nothing but Node.
 *
 * Output layout (mirrors a NocoBase-built plugin):
 *   dist/client/index.js      UMD, named define, externals: @nocobase/client + react
 *   dist/server/index.js      CommonJS, a no-op server plugin
 *   dist/index.js             re-export of the server entry
 *   dist/externalVersion.js   declared external versions
 *   packs/<pack>/paths.json   copied verbatim, fetched lazily at runtime
 *   client.js / server.js     package entry points
 *
 * Usage: node scripts/build.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const OUT = path.join(ROOT, 'dist');

const ENABLED_PACKS = ['fa-solid', 'tb-outline'];

const w = (p, s) => {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s, 'utf8');
};
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

/* ------------------------------------------------------- read the packs */
const packs = ENABLED_PACKS.map((name) => {
  const dir = path.join(ROOT, 'packs', name);
  const manifestPath = path.join(dir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    throw new Error('missing ' + path.relative(ROOT, manifestPath) + ' — run: node scripts/build-pack.js ' + name);
  }
  return { pack: name, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
});

const attributions = packs
  .map((p) => ' * ' + p.pack + ': ' + p.manifest.attribution + ' (' + p.manifest.license + ')')
  .join('\n');

/* ------------------------------------------------------- client bundle */
// Both sources are plain CommonJS modules; the tail export is stripped and the bodies are
// concatenated inside the UMD factory, which supplies the exports instead.
const stripTail = (s) => s.replace(/\nmodule\.exports\s*=\s*\{[\s\S]*?\};\s*$/, '\n');
const body = stripTail(fs.readFileSync(path.join(ROOT, 'src', 'client.js'), 'utf8'));
const pickerBody = stripTail(fs.readFileSync(path.join(ROOT, 'src', 'picker.js'), 'utf8'));

// manifests are inlined (names only, small). paths.json stays a separate lazy file.
const LABELS = { 'fa-solid': 'Font Awesome', 'tb-outline': 'Tabler' };
const PREFIX = { 'fa-solid': 'Fa', 'tb-outline': 'Tb' };
const inlinedPacks = packs.map((p) => ({
  pack: p.pack,
  label: LABELS[p.pack] || p.pack,
  prefix: PREFIX[p.pack] || '',
  manifest: { mode: p.manifest.mode, names: p.manifest.names, common: p.manifest.common || [] },
}));

// The picker needs the same names; it is derived from PACKS inside the bundle rather than
// inlined a second time — duplicating 6,500 names would double the eager payload.

const client = `/*!
 * ${pkg.name} v${pkg.version}
 * ${pkg.description}
 * Code: MIT. Icon artwork keeps its own licence:
${attributions}
 */
(function (root, factory) {
  var NAME = ${JSON.stringify(pkg.name)};
  var SELF = (typeof document !== 'undefined' && document.currentScript && document.currentScript.src) || '';
  if (typeof exports === 'object' && typeof module === 'object') {
    module.exports = factory(require('@nocobase/client'), require('react'), require('antd'), SELF);
  } else if (typeof define === 'function' && define.amd) {
    define(NAME, ['@nocobase/client', 'react', 'antd'], function (nb, React, antd) { return factory(nb, React, antd, SELF); });
  } else if (typeof exports === 'object') {
    exports[NAME] = factory(require('@nocobase/client'), require('react'), require('antd'), SELF);
  } else {
    root[NAME] = factory(root['@nocobase/client'], root.react, root.antd, SELF);
  }
})(typeof self !== 'undefined' ? self : this, function (nb, React, antd, SELF) {
  'use strict';

  var PACKS = ${JSON.stringify(inlinedPacks)};

${[body, pickerBody]
  .join('\n')
  .split('\n')
  .map((l) => (l.trim() ? '  ' + l : l))
  .join('\n')}

  var PICKER_PACKS = PACKS.map(function (p) {
    return { pack: p.pack, label: p.label, prefix: p.prefix, names: p.manifest.names, common: p.manifest.common };
  });

  var Picker = null;
  try {
    Picker = createIconPicker(React, nb, PICKER_PACKS, antd);
  } catch (e) {
    // A picker we failed to build must not take icon selection down with it.
    console.warn('[icon-packs] could not build the picker, keeping the built-in one:', e && e.message);
  }

  var Plugin = createPlugin(nb, React, {
    packs: PACKS,
    selfSrc: SELF,
    verbose: true,
    picker: Picker,
    version: ${JSON.stringify(pkg.version)},
  });
  return { __esModule: true, default: Plugin };
});
`;
w(path.join(OUT, 'client', 'index.js'), client);

/* ------------------------------------------------------- server + entries */
w(
  path.join(OUT, 'server', 'index.js'),
  `'use strict';
const { Plugin } = require('@nocobase/server');

/** Client-only plugin: the server side exists so NocoBase can register the package. */
class PluginIconPacksServer extends Plugin {}

module.exports = PluginIconPacksServer;
module.exports.default = PluginIconPacksServer;
module.exports.__esModule = true;
`
);
w(path.join(OUT, 'index.js'), "'use strict';\nmodule.exports = require('./server');\n");
w(
  path.join(OUT, 'externalVersion.js'),
  'module.exports = ' +
    JSON.stringify({ react: '18.3.1', '@nocobase/client': '2.2.4', '@nocobase/server': '2.2.4' }, null, 2) +
    ';\n'
);
w(path.join(ROOT, 'client.js'), "export { default } from './dist/client/index.js';\n");
w(path.join(ROOT, 'server.js'), "export { default } from './dist/server/index.js';\n");

/* ------------------------------------------------------- lazy pack data
 * Copied INTO dist/client/, beside the bundle. The app serves the plugin's dist/ tree
 * and refuses sibling paths, so co-locating the data guarantees it is reachable. */
let lazyBytes = 0;
for (const p of packs) {
  const from = path.join(ROOT, 'packs', p.pack, 'paths.json');
  const to = path.join(OUT, 'client', 'packs', p.pack, 'paths.json');
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  lazyBytes += fs.statSync(to).size;
}

/* ------------------------------------------------------- report */
console.log('built ' + pkg.name + ' v' + pkg.version);
console.log('  packs      : ' + packs.map((p) => p.pack + ' (' + p.manifest.names.length + ')').join(', '));
console.log('  eager      : dist/client/index.js  ' + kb(client.length) + '  (code + icon NAMES)');
console.log('  lazy       : packs/*/paths.json    ' + kb(lazyBytes) + '  (fetched on first icon render)');
console.log('\nnext: node scripts/verify.js');
