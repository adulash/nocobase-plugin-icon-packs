/**
 * Search the packs from the command line — the same substring match the picker uses.
 *
 * Useful for checking a term before typing it into the app, and for seeing whether an
 * icon lives in the curated set or only turns up through search.
 *
 * Usage:
 *   node scripts/search.js tooth
 *   node scripts/search.js tooth xray syringe      # several terms at once
 *   node scripts/search.js --limit 20 dental
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
let limit = 8;
const terms = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--limit') { limit = Number(args[++i]) || 8; continue; }
  terms.push(args[i]);
}
if (!terms.length) {
  console.log('usage: node scripts/search.js <term> [term…] [--limit N]');
  process.exit(1);
}

const packs = fs
  .readdirSync(path.join(ROOT, 'packs'))
  .filter((d) => fs.existsSync(path.join(ROOT, 'packs', d, 'manifest.json')))
  .map((d) => JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', d, 'manifest.json'), 'utf8')));

for (const term of terms) {
  const q = term.toLowerCase();
  console.log('\n"' + term + '"');
  let any = false;
  for (const m of packs) {
    const hits = m.names.filter((n) => n.toLowerCase().indexOf(q) !== -1);
    if (!hits.length) { console.log('  ' + m.pack.padEnd(11) + ' —'); continue; }
    any = true;
    const common = new Set(m.common || []);
    const shown = hits.slice(0, limit).map((n) => (common.has(n) ? n + ' *' : n));
    console.log(
      '  ' + m.pack.padEnd(11) + hits.length + ' hit' + (hits.length === 1 ? '' : 's') + ': ' + shown.join(', ') +
        (hits.length > limit ? ' … +' + (hits.length - limit) : '')
    );
  }
  if (!any) console.log('  (nothing in any pack)');
}
console.log('\n*  = already in the curated set shown before you type');
