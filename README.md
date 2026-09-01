# NocoBase Icon Packs

Adds extra icon packs to NocoBase's icon picker. NocoBase ships the Ant Design set —
836 icons, none of them domain-specific. This plugin puts **1,402 Font Awesome Free
icons** in the picker alongside them, so you can pick `FaToothOutlined` the same way you
pick `ToolOutlined`.

Built and verified against **NocoBase 2.2.4**.

---

## Install

1. Download `plugin-icon-packs-<version>.tar.gz` from [Releases](https://github.com/adulash/nocobase-plugin-icon-packs/releases).
2. Plugin manager → Add new → upload the archive.
3. Enable it.

Or drop the folder into `storage/plugins/@adulash/plugin-icon-packs` and enable it from
the plugin manager. If the app is running when you copy the files, restart the process
once so NocoBase links the package into `node_modules` — it does that at boot.

After updating an installed copy, run **clear cache**: the client bundle is served under a
fingerprinted URL that does not change when the file does, so the old bundle keeps
being served until the cache is dropped.

## Use

Open any icon picker and search — `tooth`, `stethoscope`, `syringe`, `xray`. Pack icons
appear after the built-in ones.

Icons render at `1em` and inherit `currentColor`, so they follow your theme, the active
menu highlight, and dark mode without extra styling.

## How it stays small

The picker needs every icon **name** up front, but a page almost never needs every icon's
**path data**. So the two are split:

| | size (gzip) | when it loads |
|---|---|---|
| names, in the client bundle | ~7 KB | always |
| `paths.json` | ~260 KB | on the first pack icon that actually renders |

A page that uses no pack icons downloads nothing extra. The first icon that renders pulls
`paths.json` once; everything after that is served from memory. `scripts/verify.js`
asserts this — that `load()` fetches nothing, that one render triggers exactly one fetch,
and that a second icon triggers none.

## Build from source

No bundler, no toolchain — plain Node.

```bash
node scripts/build-pack.js fa-solid   # download upstream artwork -> manifest.json + paths.json
node scripts/build.js                 # emit dist/
node scripts/verify.js                # run the checks
```

`scripts/build.js` emits the UMD module with a named AMD define that NocoBase's plugin
loader expects. The generated `packs/*/paths.json` is data, not code — regenerate it
rather than editing it.

## Notes for anyone extending this

Two things about NocoBase 2.x cost real debugging time and are worth knowing:

**There are two icon registries.** `@nocobase/client` backs rendering; `@nocobase/client-v2`
backs the icon picker. Register in only the first and you get a silent half-failure —
`hasIcon()` returns true, the icon renders wherever it is referenced, and it never shows up
in the picker, with no error anywhere. This plugin registers in both, reaching the second
through the page's AMD loader inside a `try/catch` so an install without it still works.

**The picker groups by name suffix.** Names are bucketed by `endsWith('outlined' |
'filled' | 'twotone')`; anything else lands in a group that is never rendered. Pack names
therefore end in `Outlined` — `FaToothOutlined`, not `fa-tooth`.

## Licence

Code: [MIT](LICENSE).

Icons: Font Awesome Free 6.7.2, [CC BY 4.0](https://fontawesome.com/license/free),
© Fonticons, Inc. See [NOTICE](NOTICE) — the attribution must travel with any
redistribution. This project is not affiliated with or endorsed by Fonticons, Inc.
