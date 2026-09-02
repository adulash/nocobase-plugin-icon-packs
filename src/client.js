/**
 * Client plugin source.
 *
 * Plain JS on purpose — no JSX, no bundler, no toolchain. scripts/build.js wraps this
 * into the UMD/AMD module NocoBase loads. Anyone can build this repo with plain Node.
 *
 * Two facts about NocoBase 2.x drive the whole design; both were established
 * empirically against a live 2.2.4 instance, not read from docs:
 *
 *  1. THERE ARE TWO ICON REGISTRIES.
 *     '@nocobase/client'    backs rendering (sidebar, buttons).
 *     '@nocobase/client-v2' backs the ICON PICKER.
 *     Registering in only the first gives a silent half-failure: hasIcon() is true and
 *     the icon renders, but it never appears in the picker, with no error anywhere.
 *
 *  2. THE PICKER GROUPS BY NAME SUFFIX.
 *     Names are bucketed by endsWith('outlined' | 'filled' | 'twotone'); anything else
 *     lands in a group that is never rendered. So pack names must carry the suffix.
 *
 * Lazy loading: the picker needs every NAME up front, but almost no page needs every
 * PATH. Measured for fa-solid: names 6.7 KB gzip, paths 260 KB gzip. So names ship
 * eagerly and paths are fetched once, on the first icon that actually renders.
 */
/* global React, nb */

var GLOBAL_CACHE = {}; // pack -> { name: [viewBox, d] }
var INFLIGHT = {}; // pack -> Promise

/**
 * Where the pack data lives, derived from our own <script src>.
 * Deliberately the script's OWN directory: the app serves the plugin's dist/ tree, and
 * paths outside it are refused (a sibling path returns 403, not 404). Keeping the data
 * next to the bundle means if the bundle loaded, the data is reachable too.
 */
function assetBase(selfSrc) {
  // .../dist/client/index.js?hash=x  ->  .../dist/client
  var clean = String(selfSrc || '').split('?')[0];
  var i = clean.lastIndexOf('/');
  return i > 0 ? clean.slice(0, i) : '';
}

/**
 * The pack file lives at a stable URL, so a browser that cached one version keeps serving
 * it after an upgrade. That bit us: a 0.1.x file (one path per icon, stored as a string)
 * was replayed to 0.2.x code that expects a list, and every icon rendered as ~500 paths
 * of a single character. The version query retires the old copy; normalise() below means
 * even an unversioned stale copy still draws correctly instead of exploding.
 */
function loadPaths(base, pack, version) {
  if (GLOBAL_CACHE[pack]) return Promise.resolve(GLOBAL_CACHE[pack]);
  if (!INFLIGHT[pack]) {
    INFLIGHT[pack] = fetch(base + '/packs/' + pack + '/paths.json?v=' + encodeURIComponent(version || '0'))
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (json) {
        GLOBAL_CACHE[pack] = json;
        return json;
      })
      .catch(function (e) {
        INFLIGHT[pack] = null; // let a later render retry
        console.warn('[icon-packs] failed to load "' + pack + '" paths:', e && e.message);
        return {};
      });
  }
  return INFLIGHT[pack];
}

/** Accept both the current [viewBox, [d…]] and the 0.1.x [viewBox, d] shapes. */
function normalise(entry) {
  if (!entry) return null;
  var ds = entry[1];
  return [entry[0], typeof ds === 'string' ? [ds] : ds];
}

/**
 * One component shape for every icon in a pack. It closes over the name only —
 * the path data arrives later, so 1400 icons cost 1400 tiny closures, not 1400 payloads.
 */
function makeIcon(React, base, pack, name, mode, version) {
  function PackIcon(props) {
    var cached = normalise(GLOBAL_CACHE[pack] && GLOBAL_CACHE[pack][name]);
    var state = React.useState(cached);
    var data = state[0];
    var setData = state[1];

    React.useEffect(
      function () {
        if (data) return undefined;
        var alive = true;
        loadPaths(base, pack, version).then(function (all) {
          var d = normalise(all[name]);
          if (alive && d) setData(d);
        });
        return function () {
          alive = false;
        };
      },
      [data]
    );

    var svgProps = {
      viewBox: data ? data[0] : '0 0 1 1',
      width: '1em',
      height: '1em',
      'aria-hidden': 'true',
      focusable: 'false',
    };
    if (mode === 'stroke') {
      svgProps.fill = 'none';
      svgProps.stroke = 'currentColor';
      svgProps.strokeWidth = 2;
      svgProps.strokeLinecap = 'round';
      svgProps.strokeLinejoin = 'round';
    } else {
      svgProps.fill = 'currentColor';
    }

    // data[1] is a list: Font Awesome icons are one path, Tabler icons are several.
    var shapes = null;
    if (data) {
      var ds = data[1];
      shapes = [];
      for (var i = 0; i < ds.length; i++) {
        shapes.push(React.createElement('path', { key: i, d: ds[i] }));
      }
    }

    // Reserve the box while loading so the menu does not reflow when paths land.
    return React.createElement(
      'span',
      { role: 'img', className: 'anticon', 'aria-label': name, style: props && props.style },
      React.createElement('svg', svgProps, shapes)
    );
  }
  PackIcon.displayName = name;
  return PackIcon;
}

/** Register into BOTH registries. See note 1 at the top of this file. */
function registerEverywhere(nb, icons, log) {
  var done = [];
  try {
    if (typeof nb.registerIcons === 'function') {
      nb.registerIcons(icons);
      done.push('client');
    }
  } catch (e) {
    log('register in @nocobase/client failed: ' + (e && e.message));
  }

  // client-v2 is reached through the page's AMD loader, and optionally:
  // an installation without it must still get working icons, just no picker entry.
  try {
    var amd = typeof requirejs !== 'undefined' ? requirejs : null;
    var req =
      amd &&
      (typeof amd === 'function'
        ? amd
        : typeof amd.requirejs === 'function'
        ? amd.requirejs
        : typeof amd.require === 'function'
        ? amd.require
        : null);
    if (req) {
      req(['@nocobase/client-v2'], function (v2) {
        try {
          if (v2 && typeof v2.registerIcons === 'function') {
            v2.registerIcons(icons);
            log('picker registry updated (' + v2.icons.size + ' icons)');
          }
        } catch (e) {
          log('register in @nocobase/client-v2 failed: ' + (e && e.message));
        }
      });
      done.push('client-v2(async)');
    } else {
      log('AMD loader not reachable — icons will render but will not appear in the picker');
    }
  } catch (e) {
    log('client-v2 lookup threw: ' + (e && e.message));
  }
  return done;
}

/**
 * PROBE (v0.2.1): can a plugin replace NocoBase's icon picker?
 *
 * The built-in picker renders every registered icon in the active tab at once. With the
 * packs installed that is ~7,000 icons, and opening it freezes the tab for seconds.
 * The fix is our own picker — a tab per pack, a small default set, search on demand —
 * but that is only worth building if the override actually takes effect.
 *
 * NocoBase registers the picker by name:
 *   this.flowEngine.flowSettings.registerComponents({ IconPicker: ... })
 * so a plugin should be able to register over it. Two things could still defeat that:
 * plugin load ORDER (if ours loads first, the core re-registers over us), and a second
 * picker used by the classic client. This probe reports both instead of assuming.
 */
function probePicker(app, React, log) {
  var report = { flowSettings: null, appComponents: null, previous: null };
  try {
    // The dialogs reference the picker as `"x-component": "IconPicker"`, i.e. resolved by
    // NAME. Two registries can answer that name — the schema-component registry
    // (app.addComponents) and the flow-settings one — and which applies depends on the
    // surface. Register in both rather than guess.
    var fset = app && app.flowEngine && app.flowEngine.flowSettings;

    var existing =
      (fset && fset.components && fset.components.IconPicker) ||
      (fset && typeof fset.getComponent === 'function' && fset.getComponent('IconPicker')) ||
      null;
    report.previous = existing ? existing.displayName || existing.name || 'anonymous' : null;

    function ProbePicker(props) {
      return React.createElement(
        'span',
        {
          style: {
            display: 'inline-block',
            padding: '2px 8px',
            border: '1px solid #d9363e',
            borderRadius: 6,
            color: '#d9363e',
            fontSize: 12,
          },
          'data-icon-packs-probe': '1',
        },
        'PICKER OVERRIDE OK'
      );
    }
    ProbePicker.displayName = 'IconPacksProbePicker';

    if (fset && typeof fset.registerComponents === 'function') {
      fset.registerComponents({ IconPicker: ProbePicker });
      report.flowSettings = 'registered';
    } else {
      report.flowSettings = 'unavailable';
    }

    if (app && typeof app.addComponents === 'function') {
      app.addComponents({ IconPicker: ProbePicker });
      report.appComponents = 'registered';
    } else {
      report.appComponents = 'unavailable';
    }

    log('picker override -> flowSettings=' + report.flowSettings +
        ' addComponents=' + report.appComponents +
        ' (previous was "' + report.previous + '")');
  } catch (e) {
    log('picker override threw: ' + (e && e.message));
  }
  return report;
}

/**
 * Install our picker in place of the built-in one.
 *
 * Registered in BOTH registries because `"x-component": "IconPicker"` is resolved by name
 * and the surface decides which registry answers. Re-asserted on the next tick in case a
 * core plugin registers after us — plugin load order is not ours to control.
 *
 * Failure is contained: if anything here throws, the built-in picker stays in place and
 * icon selection keeps working, just slowly.
 */
function installPicker(app, Picker, log) {
  var done = [];
  function register() {
    try {
      var fset = app && app.flowEngine && app.flowEngine.flowSettings;
      if (fset && typeof fset.registerComponents === 'function') {
        fset.registerComponents({ IconPicker: Picker });
        done.push('flowSettings');
      }
      if (app && typeof app.addComponents === 'function') {
        app.addComponents({ IconPicker: Picker });
        done.push('addComponents');
      }
    } catch (e) {
      log('picker install failed: ' + (e && e.message) + ' — the built-in picker stays');
    }
  }
  register();
  setTimeout(register, 0);
  return done;
}

function createPlugin(nb, React, options) {
  var PACKS = options.packs; // [{ pack, manifest }]
  var VERBOSE = options.verbose;
  var PROBE = options.probePicker;

  return class PluginIconPacksClient extends nb.Plugin {
    async load() {
      var base = assetBase(options.selfSrc);
      var log = function (msg) {
        if (VERBOSE) console.log('[icon-packs] ' + msg);
      };

      var icons = {};
      var total = 0;
      for (var i = 0; i < PACKS.length; i++) {
        var p = PACKS[i];
        var mode = p.manifest.mode || 'fill';
        for (var j = 0; j < p.manifest.names.length; j++) {
          var name = p.manifest.names[j];
          icons[name] = makeIcon(React, base, p.pack, name, mode, options.version);
          total++;
        }
      }

      var where = registerEverywhere(nb, icons, log);
      log('registered ' + total + ' icons from ' + PACKS.length + ' pack(s) into: ' + where.join(', '));
      log('paths are lazy — nothing else is downloaded until an icon renders');

      if (PROBE) {
        var r = probePicker(this.app, React, log);
        console.log('[icon-packs] picker probe ->', JSON.stringify(r));
      } else if (options.picker) {
        var where2 = installPicker(this.app, options.picker, log);
        log('picker replaced in: ' + (where2.length ? where2.join(', ') : 'nowhere — built-in kept'));
      }
    }
  };
}

module.exports = { createPlugin: createPlugin, assetBase: assetBase, makeIcon: makeIcon };
