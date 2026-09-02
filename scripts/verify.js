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
  const local = path.join(ROOT, rel.split('?')[0].replace(/^\/+/, ''));
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
  defined && JSON.stringify(defined.deps) === JSON.stringify(['@nocobase/client', 'react', 'antd']),
  'externals are ' + JSON.stringify(defined && defined.deps)
);

// antd is only used to build the picker; nothing here renders it.
const antdStub = {
  Button: function Button() {},
  Popover: function Popover() {},
  Input: function Input() {},
  Empty: Object.assign(function Empty() {}, { PRESENTED_IMAGE_SIMPLE: 'stub' }),
};

const mod = defined.factory(v1, React, antdStub);
check(mod && mod.__esModule === true, 'marked __esModule');
check(typeof mod.default === 'function', 'exports a default class');

const instance = new mod.default({});
check(instance instanceof FakePlugin, 'class actually extends Plugin (ES6 inheritance)');

/* ---------------------------------------------- load() */
(async () => {
  const packDirs = fs
    .readdirSync(path.join(ROOT, 'packs'))
    .filter((d) => fs.existsSync(path.join(ROOT, 'packs', d, 'manifest.json')));
  const manifests = packDirs.map((d) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', d, 'manifest.json'), 'utf8'))
  );
  const expected = manifests.reduce((a, m) => a + m.count, 0);

  fetched = [];
  await instance.load();
  await new Promise((r) => setTimeout(r, 0));

  console.log('  ....  packs: ' + manifests.map((m) => m.pack + '=' + m.count).join(', '));
  check(v1.icons.size === expected, 'registered ' + v1.icons.size + ' icons in @nocobase/client (expected ' + expected + ')');
  check(v2.icons.size === expected, 'registered ' + v2.icons.size + ' icons in @nocobase/client-v2 (the PICKER registry)');
  check(v1.hasIcon('FaToothOutlined'), 'FaToothOutlined resolvable (fill pack)');
  check(v1.hasIcon('TbDentalOutlined'), 'TbDentalOutlined resolvable (stroke pack)');

  const suffixed = manifests.every((m) => m.names.every((n) => /(?:Outlined|Filled|TwoTone)$/.test(n)));
  check(suffixed, 'every name in every pack carries a picker-visible suffix');

  const collisions = [];
  const seen = new Set();
  for (const m of manifests) {
    for (const n of m.names) {
      const k = n.toLowerCase();
      if (seen.has(k)) collisions.push(n);
      seen.add(k);
    }
  }
  check(collisions.length === 0, 'no name collisions between packs' + (collisions.length ? ': ' + collisions.slice(0, 5) : ''));

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
  check(/paths\.json\?v=/.test(fetched[0] || ''), 'the lazy file is version-stamped, so an upgrade cannot serve a stale cached copy');
  check(/fa-solid/.test(fetched[0] || ''), 'only the pack that was rendered got fetched');

  /* second icon from the SAME pack must reuse the cache, not fetch again */
  const Icon2 = v1.icons.get('faheartoutlined') || v1.icons.get('fastaroutlined');
  if (Icon2) {
    hooks.length = 0;
    Icon2({});
    const e2 = hooks.find((h) => h.effect);
    if (e2) e2.effect();
    await new Promise((r) => setTimeout(r, 10));
    check(fetched.length === 1, 'a second icon of the same pack reuses the cache (still ' + fetched.length + ' fetch)');
  }

  /* an icon from the OTHER pack fetches its own file — packs stay independent */
  const Tb = v1.icons.get('tbdentaloutlined');
  check(typeof Tb === 'function', 'stroke-pack icon component exists');
  if (Tb) {
    hooks.length = 0;
    Tb({});
    const e3 = hooks.find((h) => h.effect);
    if (e3) e3.effect();
    await new Promise((r) => setTimeout(r, 10));
    check(fetched.length === 2, 'the other pack fetched separately (' + fetched.length + ' total)');
    check(/tb-outline/.test(fetched[1] || ''), 'second fetch is the tb-outline pack');

    /* stroke icons must not be filled, and multi-path icons must draw every path */
    hooks.length = 0;
    const drawn = Tb({});
    const svg = drawn.children[0];
    check(svg.props.fill === 'none' && svg.props.stroke === 'currentColor', 'stroke pack renders stroked, not filled');
    const paths = (svg.children || []).filter(Boolean);
    check(paths.length >= 1, 'renders ' + paths.length + ' path(s) — multi-path icons are not truncated');
  }

  /* ---------------------------------------------- picker (pure helpers, no DOM) */
  console.log('\n  -- picker --');
  const picker = require(path.join(ROOT, 'src', 'picker.js'));
  const LABELS = { 'fa-solid': 'Font Awesome', 'tb-outline': 'Tabler' };
  const PREFIX = { 'fa-solid': 'Fa', 'tb-outline': 'Tb' };
  const pickerPacks = manifests.map((m) => ({
    pack: m.pack,
    label: LABELS[m.pack] || m.pack,
    prefix: PREFIX[m.pack] || '',
    names: m.names,
    common: m.common || [],
  }));

  // A realistic registry: antd keys are lower-cased, pack keys too. The antd names below
  // include the ones that tripped prefix matching — FacebookOutlined and friends start
  // with "Fa" but belong to Ant Design, not to the Font Awesome pack.
  const antdSample = ['homeoutlined', 'toolfilled', 'staroutlined', 'clockcircletwotone',
    'facebookoutlined', 'fastforwardoutlined', 'falloutlined'];
  const registry = antdSample
    .concat(manifests.flatMap((m) => m.names.slice(0, 50).map((n) => n.toLowerCase())));

  const sources = picker.buildSources(registry, pickerPacks);
  check(sources[0].key === 'antd', 'first tab is Ant Design');
  check(sources.length === 1 + pickerPacks.length, 'one tab per source (' + sources.map((s) => s.key).join(', ') + ')');
  check(
    sources[0].names.length === antdSample.length,
    'pack icons do not leak into the Ant Design tab, and Ant names starting with a pack prefix stay put (' +
      sources[0].names.length + ' of ' + antdSample.length + ')'
  );

  for (const s of sources) {
    const opened = picker.selectNames(s, '', 'Outlined');
    check(
      opened.shown.length <= picker.CAP,
      s.key + ': opens on ' + opened.shown.length + ' icons (cap ' + picker.CAP + ') — this is the freeze fix'
    );
  }

  const faTab = sources.find((s) => s.key === 'fa-solid');
  const tbTab = sources.find((s) => s.key === 'tb-outline');
  check(picker.selectNames(faTab, '').shown.length === (faTab.common || []).length,
    'a pack opens on its curated set, not its full list');
  const dent = picker.selectNames(tbTab, 'dental');
  check(dent.total >= 2 && dent.shown.some((n) => n === 'TbDentalOutlined'),
    'search reaches the whole pack, not just the curated set (' + dent.total + ' hits for "dental")');

  const huge = picker.selectNames(tbTab, 'a');
  check(huge.capped && huge.shown.length === picker.CAP,
    'a broad search is capped at ' + picker.CAP + ' of ' + huge.total + ' and says so');

  const styled = picker.selectNames(sources[0], '', 'Filled');
  check(styled.shown.every((n) => picker.styleOf(n) === 'Filled'), 'the Ant Design tab still filters by style');

  console.log('\n' + (pass ? 'All checks passed.' : 'One or more checks FAILED.'));
  process.exit(pass ? 0 : 1);
})();
