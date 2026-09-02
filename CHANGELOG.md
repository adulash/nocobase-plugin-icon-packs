# Changelog

## 0.3.0

**Replaces NocoBase's icon picker.** With two packs installed the built-in picker rendered
about 7,000 icons in one pass and froze the tab for seconds on open. It is now our own
component, registered over the built-in one by name:

- **A tab per source** — Ant Design, Font Awesome, Tabler. The Ant Design tab keeps the
  original Outlined / Filled / Two tone filter. No counts are shown: how many icons a pack
  holds is the plugin's business, not the business of the person picking one.
- **Packs open on 60 general-purpose icons**, not on 1,402 or 5,130 — navigation, content,
  data, actions, communication, people, commerce, time, status, security, tech, places.
  Deliberately not one industry's toolbox. Search reaches the whole pack.
- **At most 120 icons are painted at once**, and the footer says so: *"More matches than
  shown — refine the search"*. What is on screen stays bounded however many packs are
  installed, and nobody is left thinking an icon is missing when it is merely further down.
- Measured on the same app that froze: opening now blocks for **8 ms**.

Also in this release:

- **Fixed: pack tabs stole Ant Design icons.** Sources were decided by name prefix, so
  Ant's own `FacebookOutlined`, `FastForwardOutlined` and five others fell into the Font
  Awesome tab, which showed 829 of 836 built-in icons. Membership is now exact.
- **Fixed: a cached pack file survived the upgrade.** `paths.json` is served from a stable
  URL, so browsers replayed the 0.1.x shape (one path as a string) to 0.2.x code that
  expects a list — every icon rendered as ~500 single-character paths. The URL now carries
  the plugin version, and both shapes are accepted so a stale copy still draws.

## 0.2.0

- Adds the **tb-outline** pack: 5,130 [Tabler Icons](https://tabler.io/icons) 3.46.0,
  MIT licensed, registered as `Tb…Outlined`. Stroked line icons — a closer match to Ant
  Design's own style than the filled Font Awesome set.
- Icons may now be drawn from **several paths**, which Tabler's line icons need. The
  transparent bounding-box path Tabler puts first in every symbol is dropped; kept, it
  would draw as a square once the component applies its own stroke.
- Each pack's path data is fetched **independently** — rendering a Font Awesome icon does
  not download Tabler's, and vice versa.
- Icon names total 6,532. That is a large picker; see the note in the README.

## 0.1.0

First release.

- Adds the **fa-solid** pack: 1,402 Font Awesome Free 6.7.2 icons, registered as
  `Fa…Outlined` so they appear in NocoBase's icon picker beside the built-in set.
- Registers into **both** icon registries (`@nocobase/client` for rendering,
  `@nocobase/client-v2` for the picker). Registering in only one is a silent
  half-failure: the icon renders but never shows up in the picker.
- **Lazy path data.** Icon names ship in the client bundle (~7 KB gzip); the path data
  (~325 KB over the wire) is fetched once, on the first pack icon that actually renders.
  A page that uses no pack icons downloads nothing extra.
- Icons render at `1em` with `currentColor`, so they follow the theme, the active menu
  highlight, and dark mode.
- Built and verified against NocoBase 2.2.4.

Not in this release: an in-app settings page, replace mode driven from the UI, and the
Tabler and Lucide packs.
