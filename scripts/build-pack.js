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
    prefix: 'Fa',
    suffix: 'Outlined', // the picker only lists names ending in outlined/filled/twotone
    license: 'CC-BY-4.0',
    attribution: 'Font Awesome Free 6.7.2 by @fontawesome — https://fontawesome.com/license/free',
    mode: 'fill',
  },
};

/** "arrow-right-long" -> "FaArrowRightLongOutlined" */
const toName = (id, { prefix, suffix }) =>
  prefix + id.split(/[-_]/).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') + suffix;

/** Extract <symbol id=".." viewBox=".."><path d=".."/></symbol> from an FA sprite. */
function parseSprite(svg) {
  const out = {};
  const skipped = [];
  const re = /<symbol[^>]*\bid="([^"]+)"[^>]*\bviewBox="([^"]+)"[^>]*>([\s\S]*?)<\/symbol>/g;
  let m;
  while ((m = re.exec(svg))) {
    const [, id, viewBox, body] = m;
    const paths = [...body.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((p) => p[1]);
    // One path per icon is the norm. Anything else would render wrong if we silently took the first.
    if (paths.length !== 1) { skipped.push(id + ' (' + paths.length + ' paths)'); continue; }
    out[id] = [viewBox, paths[0]];
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

  const { icons, skipped } = parseSprite(svg);
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

  const manifest = {
    pack: key,
    count: names.length,
    mode: cfg.mode,
    license: cfg.license,
    attribution: cfg.attribution,
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
  console.log('\nsample: ' + names.slice(0, 3).join(', '));
})();
