/**
 * Pack generator.
 *
 * Downloads an upstream icon set and turns it into the two files the plugin ships:
 *   packs/<pack>/manifest.json  — names only. Loaded EAGERLY (the picker needs the names).
 *   packs/<pack>/paths.json     — { name: [viewBox, d] }. Loaded LAZILY on first icon render.
 *
 * The split is the whole point: a page that renders 8 icons must not pay for 1400.
 *
 * Usage: node scripts/build-pack.js [pack]
 *   pack: fa-solid (default)
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');

const PACKS = {
  'fa-solid': {
    url: 'https://unpkg.com/@fortawesome/fontawesome-free@6.7.2/sprites/solid.svg',
    idPrefix: '',
    prefix: 'Fa',
    suffix: 'Outlined', // the picker only lists names ending in outlined/filled/twotone
    license: 'CC-BY-4.0',
    attribution: 'Font Awesome Free 6.7.2 by @fontawesome — https://fontawesome.com/license/free',
    mode: 'fill',
    // Shown before anyone types. A picker that opens on 1,400 icons is a wall; one that
    // opens on ~50 useful ones and searches the rest is a tool.
    //
    // Kept DELIBERATELY GENERIC — navigation, content, data, actions, communication,
    // people, commerce, time, status, security, tech, places. This is a general-purpose
    // plugin, so its defaults must not read as one industry's toolbox; anything
    // specialised is one search away.
    //
    // Ids missing upstream are dropped and reported — the list is a wish, the sprite is
    // the truth.
    common: [
      // navigation & chrome
      'house', 'magnifying-glass', 'bars', 'gear', 'sliders', 'filter', 'arrows-rotate',
      // content
      'file-lines', 'folder', 'image', 'link', 'bookmark', 'tag',
      // data
      'database', 'table-cells', 'chart-line', 'chart-pie', 'chart-column',
      // actions
      'plus', 'pen', 'trash', 'download', 'upload', 'copy', 'share-nodes', 'print',
      // communication
      'envelope', 'comment', 'bell', 'paper-plane',
      // people
      'user', 'users', 'id-card',
      // commerce
      'cart-shopping', 'credit-card', 'box', 'truck', 'store',
      // time
      'calendar-days', 'clock', 'clock-rotate-left',
      // status
      'circle-check', 'triangle-exclamation', 'circle-info', 'star', 'heart',
      // security
      'lock', 'key', 'shield-halved',
      // tech
      'code', 'terminal', 'cloud', 'globe', 'laptop', 'mobile-screen',
      // places & misc
      'location-dot', 'building', 'briefcase', 'lightbulb', 'flag',
    ],
  },
  'tb-outline': {
    url: 'https://unpkg.com/@tabler/icons-sprite@3.46.0/dist/tabler-sprite.svg',
    idPrefix: 'tabler-', // every symbol id is prefixed in the sprite
    prefix: 'Tb',
    suffix: 'Outlined',
    license: 'MIT',
    attribution: 'Tabler Icons 3.46.0 — https://tabler.io/icons',
    mode: 'stroke',
    // Same principle as fa-solid above: broad and neutral, not one industry's toolbox.
    common: [
      // navigation & chrome
      'home', 'search', 'menu-2', 'settings', 'adjustments', 'filter', 'refresh',
      // content
      'file-text', 'folder', 'photo', 'link', 'bookmark', 'tag',
      // data
      'database', 'table', 'chart-line', 'chart-pie', 'chart-bar',
      // actions
      'plus', 'pencil', 'trash', 'download', 'upload', 'copy', 'share', 'printer',
      // communication
      'mail', 'message', 'bell', 'send',
      // people
      'user', 'users', 'id',
      // commerce
      'shopping-cart', 'credit-card', 'package', 'truck', 'building-store',
      // time
      'calendar', 'clock', 'history',
      // status
      'circle-check', 'alert-triangle', 'info-circle', 'star', 'heart',
      // security
      'lock', 'key', 'shield',
      // tech
      'code', 'terminal-2', 'cloud', 'world', 'device-laptop', 'device-mobile',
      // places & misc
      'map-pin', 'building', 'briefcase', 'bulb', 'flag',
    ],
  },
};

/** "arrow-right-long" -> "FaArrowRightLongOutlined" */
const toName = (id, { prefix, suffix }) =>
  prefix + id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') + suffix;

/**
 * Extract <symbol id=".." viewBox="..">…</symbol> from a sprite.
 *
 * Two shapes to handle:
 *  - Font Awesome: exactly one filled <path> per symbol.
 *  - Tabler: several stroked <path>s, preceded by a transparent bounding-box path
 *    (`stroke="none" … fill="none"`). That box must be dropped — kept, it draws as a
 *    square once the component applies its own stroke/fill.
 */
function parseSprite(svg, cfg) {
  const out = {};
  const skipped = [];
  const re = /<symbol[^>]*\bid="([^"]+)"[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  let m;
  while ((m = re.exec(svg))) {
    const [, rawId, viewBox, body] = m;
    const id = cfg.idPrefix && rawId.startsWith(cfg.idPrefix) ? rawId.slice(cfg.idPrefix.length) : rawId;

    const paths = [...body.matchAll(/<path\b([^>]*)>/g)]
      .map((p) => p[1])
      .filter((attrs) => !(/\bstroke="none"/.test(attrs) && /\bfill="none"/.test(attrs)))
      .map((attrs) => (attrs.match(/\sd="([^"]+)"/) || [])[1])
      .filter(Boolean);

    // Anything drawn with a primitive other than <path> would be silently lost, so skip it
    // rather than ship a half-drawn icon.
    const hasOtherShapes = /<(circle|rect|ellipse|polyline|polygon|line)\b/.test(body);
    if (!paths.length || hasOtherShapes) {
      skipped.push(id + (hasOtherShapes ? ' (non-path shapes)' : ' (no paths)'));
      continue;
    }
    out[id] = [viewBox, paths];
  }
  return { icons: out, skipped };
}

const gz = (s) => zlib.gzipSync(Buffer.from(s, 'utf8')).length;
const kb = (n) => (n / 1024).toFixed(1) + ' KB';

(async () => {
  const key = process.argv[2] || 'fa-solid';
  const cfg = PACKS[key];
  if (!cfg) throw new Error('unknown pack: ' + key);

  const srcDir = path.join(ROOT, 'packs', 'src');
  fs.mkdirSync(srcDir, { recursive: true });
  const cache = path.join(srcDir, key + '.svg');

  let svg;
  if (fs.existsSync(cache)) {
    svg = fs.readFileSync(cache, 'utf8');
    console.log('using cached source: ' + path.relative(ROOT, cache));
  } else {
    console.log('downloading ' + cfg.url);
    const r = await fetch(cfg.url);
    if (!r.ok) throw new Error('download failed: ' + r.status);
    svg = await r.text();
    fs.writeFileSync(cache, svg, 'utf8');
  }

  const { icons, skipped } = parseSprite(svg, cfg);
  const ids = Object.keys(icons);
  if (!ids.length) throw new Error('no symbols parsed — sprite format changed?');

  // name -> [viewBox, d]
  const paths = {};
  const names = [];
  for (const id of ids) {
    const name = toName(id, cfg);
    names.push(name);
    paths[name] = icons[id];
  }
  names.sort();

  // Curated defaults, resolved against what the sprite actually contains.
  const common = (cfg.common || []).filter((id) => icons[id]).map((id) => toName(id, cfg));
  const missing = (cfg.common || []).filter((id) => !icons[id]);

  const manifest = {
    pack: key,
    count: names.length,
    mode: cfg.mode,
    license: cfg.license,
    attribution: cfg.attribution,
    common,
    names,
  };

  const outDir = path.join(ROOT, 'packs', key);
  fs.mkdirSync(outDir, { recursive: true });
  const manifestStr = JSON.stringify(manifest);
  const pathsStr = JSON.stringify(paths);
  fs.writeFileSync(path.join(outDir, 'manifest.json'), manifestStr, 'utf8');
  fs.writeFileSync(path.join(outDir, 'paths.json'), pathsStr, 'utf8');

  console.log('\npack: ' + key + '  ·  ' + names.length + ' icons');
  if (skipped.length) {
    console.log('skipped (not a single <path>): ' + skipped.length);
    skipped.slice(0, 5).forEach((s) => console.log('  - ' + s));
  }
  console.log('\n--- size budget (this decides eager vs lazy) ---');
  console.log('manifest.json  raw ' + kb(manifestStr.length) + '   gzip ' + kb(gz(manifestStr)) + '   <- always loaded');
  console.log('paths.json     raw ' + kb(pathsStr.length) + '   gzip ' + kb(gz(pathsStr)) + '   <- lazy');
  console.log('combined       raw ' + kb(manifestStr.length + pathsStr.length) +
              '   gzip ' + kb(gz(manifestStr) + gz(pathsStr)));
  console.log('\ncommon (shown before search): ' + common.length + ' of ' + (cfg.common || []).length + ' requested');
  if (missing.length) console.log('  not in this pack: ' + missing.join(', '));
  console.log('sample: ' + names.slice(0, 3).join(', '));
})();
