# Changelog

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
