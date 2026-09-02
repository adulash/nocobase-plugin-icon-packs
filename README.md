# NocoBase Icon Packs

Adds extra icon packs to NocoBase's icon picker. NocoBase ships the Ant Design set —
836 icons, none of them domain-specific. This plugin adds **6,532 more**, so you can pick
`FaCartShoppingOutlined` or `TbDeviceLaptopOutlined` the same way you pick `ToolOutlined`.

| pack | icons | style | licence | prefix |
|---|---|---|---|---|
| `fa-solid` | 1,402 | filled | [CC BY 4.0](https://fontawesome.com/license/free) | `Fa…Outlined` |
| `tb-outline` | 5,130 | stroked | [MIT](https://github.com/tabler/tabler-icons/blob/main/LICENSE) | `Tb…Outlined` |

Tabler's stroked icons sit more comfortably beside Ant Design's own line style; Font
Awesome is denser and covers subjects Tabler does not. Both are searchable together.

Built and verified against **NocoBase 2.2.4**.

![The icon picker with the plugin installed: tabs for Ant Design, Font Awesome and
Tabler, the Font Awesome tab open on sixty common icons, and a footer reading "Common
icons — search for more"](docs/picker.png)

*A tab per source, 60 general-purpose icons before you type, and search across the whole pack.
No counts, no walls of icons: the picker paints at most 120 at a time and says when there
are more.*

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

Open any icon picker, choose a tab, and search — `invoice`, `dashboard`, `warehouse`,
`microscope`, `rocket`, whatever the screen is about. Each pack opens on sixty common
icons; the rest is one search away.

To check a term before you go looking for it:

```bash
node scripts/search.js invoice warehouse rocket
```

Icons render at `1em` and inherit `currentColor`, so they follow your theme, the active
menu highlight, and dark mode without extra styling.

## How it stays small

The picker needs every icon **name** up front, but a page almost never needs every icon's
**path data**. So the two are split:

| | size (gzip) | when it loads |
|---|---|---|
| all 6,532 names, in the client bundle | ~28 KB | always |
| `fa-solid/paths.json` | ~260 KB | on the first Font Awesome icon that renders |
| `tb-outline/paths.json` | ~218 KB | on the first Tabler icon that renders |

A page that uses no pack icons downloads nothing extra, and the packs are independent —
rendering a Font Awesome icon does not pull Tabler's data. The first icon of a pack fetches
that pack once; everything after is served from memory. `scripts/verify.js` asserts all of
it: that `load()` fetches nothing, that one render triggers exactly one fetch, that a second
icon of the same pack triggers none, and that the other pack fetches separately.

## The picker

The plugin also replaces NocoBase's icon picker, because the built-in one renders every
icon of the active tab in a single pass. That is fine for the 836 it was written for and
unusable at 7,000 — opening it froze the tab for seconds.

Ours keeps the rendered count bounded instead:

- a tab per source — Ant Design, Font Awesome, Tabler;
- the Ant Design tab keeps its Outlined / Filled / Two tone filter, unchanged;
- a pack opens on 60 general-purpose icons, and search reaches the whole pack;
- at most 120 icons are painted at once, and the footer says *"More matches than shown —
  refine the search"* rather than pretending the rest do not exist.

Opening it blocks for about **8 ms** on the app that used to freeze.

It is installed by registering over the name `IconPicker` in both registries NocoBase
resolves it from. If that registration fails the built-in picker simply stays, and icon
selection keeps working — slowly, but working.

## Build from source

No bundler, no toolchain — plain Node.

```bash
node scripts/build-pack.js fa-solid    # download upstream artwork -> manifest.json + paths.json
node scripts/build-pack.js tb-outline
node scripts/build.js                  # emit dist/
node scripts/verify.js                 # run the checks
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
therefore end in `Outlined` — `FaCartShoppingOutlined`, not `fa-cart-shopping`.

## Licence

Code: [MIT](LICENSE).

Icons keep their upstream licences — see [NOTICE](NOTICE):

- **Font Awesome Free 6.7.2** — [CC BY 4.0](https://fontawesome.com/license/free),
  © Fonticons, Inc. The attribution must travel with any redistribution.
- **Tabler Icons 3.46.0** — [MIT](https://github.com/tabler/tabler-icons/blob/main/LICENSE),
  © Paweł Kuna.

This project is not affiliated with or endorsed by Fonticons, Inc. or Tabler.
