/**
 * Local verification — runs the built bundle against stand-ins for React and the two
 * NocoBase icon registries. Catches the failures that are expensive to diagnose in a
 * browser, before anything is uploaded anywhere.
 *
 * Usage: node scripts/verify.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const FILE = path.join(ROOT, 'dist', 'client', 'index.js');

let pass = true;
const check = (cond, msg) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + msg);
  if (!cond) pass = false;
};

/* ---------------------------------------------- stand-ins */
const mkRegistry = () => {
  const map = new Map();
  return {
    icons: map,
    registerIcon: (n, c) => map.set(String(n).toLowerCase(), c),
    registerIcons: (o) => Object.keys(o).forEach((k) => map.set(k.toLowerCase(), o[k])),
    hasIcon: (n) => !!n && map.has(String(n).toLowerCase()),
  };
};
class FakePlugin {
  constructor(app) { this.app = app; }
}
const v1 = Object.assign(mkRegistry(), { Plugin: FakePlugin });
const v2 = mkRegistry();

const hooks = [];
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }),
  useState: (init) => { const box = { v: typeof init === 'function' ? init() : init }; hooks.push(box); return [box.v, (nv) => { box.v = nv; }]; },
  useEffect: (fn) => { hooks.push({ effect: fn }); },
};

let fetched = [];
global.fetch = (url) => {
  fetched.push(url);
  const rel = String(url).replace(/^https?:\/\/[^/]+/, '');
  const local = path.join(ROOT, rel.replace(/^\/+/, ''));
  if (!fs.existsSync(local)) return Promise.resolve({ ok: false, status: 404 });
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(JSON.parse(fs.readFileSync(local, 'utf8'))) });
};

/* ---------------------------------------------- AMD loader stand-in */
let defined = null;
const sandbox = {};
sandbox.define = Object.assign(function (name, deps, factory) { defined = { name, deps, factory }; }, { amd: true });
sandbox.requirejs = { require: (deps, cb) => { if (deps[0] === '@nocobase/client-v2') cb(v2); } };
sandbox.document = { currentScript: { src: '/dist/client/index.js?hash=abc' } };

console.log('verifying ' + path.relative(ROOT, FILE) + '\n');
const code = fs.readFileSync(FILE, 'utf8');
new Function('self', 'define', 'requirejs', 'document', 'console', code)(
  sandbox, sandbox.define, sandbox.requirejs, sandbox.document, console
);

check(!!defined, 'defines an AMD module');
check(defined && defined.name === pkg.name, 'module name matches package name');
check(
  defined && JSON.stringify(defined.deps) === JSON.stringify(['@nocobase/client', 'react']),
  'externals are ' + JSON.stringify(defined && defined.deps)
);

const mod = defined.factory(v1, React);
check(mod && mod.__esModule === true, 'marked __esModule');
check(typeof mod.default === 'function', 'exports a default class');

const instance = new mod.default({});
check(instance instanceof FakePlugin, 'class actually extends Plugin (ES6 inheritance)');

/* ---------------------------------------------- load() */
(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', 'fa-solid', 'manifest.json'), 'utf8'));
  fetched = [];
  await instance.load();
  await new Promise((r) => setTimeout(r, 0));

  check(v1.icons.size === manifest.count, 'registered ' + v1.icons.size + ' icons in @nocobase/client (expected ' + manifest.count + ')');
  check(v2.icons.size === manifest.count, 'registered ' + v2.icons.size + ' icons in @nocobase/client-v2 (the PICKER registry)');
  check(v1.hasIcon('FaToothOutlined'), 'FaToothOutlined resolvable');

  const suffixed = manifest.names.every((n) => /(?:Outlined|Filled|TwoTone)$/.test(n));
  check(suffixed, 'every name carries a picker-visible suffix');

  /* the point of the whole design: registering must not download the paths */
  check(fetched.length === 0, 'load() downloaded nothing (lazy) — fetches so far: ' + fetched.length);

  /* now render one icon and confirm the payload arrives */
  const Icon = v1.icons.get('fatoothoutlined');
  check(typeof Icon === 'function', 'icon component is a function');
  hooks.length = 0;
  const first = Icon({});
  const effect = hooks.find((h) => h.effect);
  check(!!effect, 'first render schedules a load effect');
  check(first.props.className === 'anticon', 'root carries the anticon class antd expects');
  check(first.children[0].type === 'svg', 'renders an svg placeholder while loading');

  if (effect) effect.effect();
  await new Promise((r) => setTimeout(r, 10));
  check(fetched.length === 1, 'exactly one fetch triggered by rendering: ' + JSON.stringify(fetched));
  check(/paths\.json$/.test(fetched[0] || ''), 'the lazy file is paths.json');

  /* second icon must reuse the cache, not fetch again */
  const Icon2 = v1.icons.get('faheartoutlined') || v1.icons.get('fastaroutlined');
  if (Icon2) {
    hooks.length = 0;
    Icon2({});
    const e2 = hooks.find((h) => h.effect);
    if (e2) e2.effect();
    await new Promise((r) => setTimeout(r, 10));
    check(fetched.length === 1, 'a second icon reuses the cache (still ' + fetched.length + ' fetch)');
  }

  console.log('\n' + (pass ? 'All checks passed.' : 'One or more checks FAILED.'));
  process.exit(pass ? 0 : 1);
})();
