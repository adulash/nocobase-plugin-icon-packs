/**
 * Our replacement for NocoBase's icon picker.
 *
 * WHY IT EXISTS
 * The built-in picker renders every registered icon of the active tab in one pass. That
 * is fine for the 836 Ant Design icons it was written for, and unusable once packs push
 * the registry past 7,000 — opening it froze the tab for seconds.
 *
 * The fix is not a faster render, it is rendering less: a tab per source, ~50 curated
 * icons shown before anyone types, search across the whole source, and a hard cap on how
 * many results are painted at once. What is on screen stays bounded no matter how many
 * packs are installed.
 *
 * HOW IT IS INSTALLED
 * NocoBase resolves the picker by name (`"x-component": "IconPicker"`), from two
 * registries — the schema-component one and the flow-settings one. Registering in both
 * from a plugin replaces it; proved against 2.2.4 before this was written.
 *
 * The helpers below are pure and exported so they can be tested without a DOM.
 */
/* global React */

var CAP = 120; // most icons painted at once; the number the old picker had no ceiling on

/**
 * Which source does a registered icon name belong to?
 *
 * By exact membership, NOT by prefix. Prefix matching looked right and was wrong: Ant
 * Design's own FacebookOutlined, FastForwardOutlined and five others start with "Fa", so
 * the Font Awesome tab swallowed seven built-in icons and the Ant tab showed 829 of 836.
 * The manifests already list every name a pack owns, so ask them.
 *
 * The lookup is lower-cased because the registry lower-cases its keys
 * (`fatoothoutlined`) while the manifests keep display casing (`FaToothOutlined`).
 */
function indexPacks(packs) {
  var index = {};
  for (var i = 0; i < packs.length; i++) {
    var names = packs[i].names || [];
    for (var j = 0; j < names.length; j++) index[names[j].toLowerCase()] = packs[i].pack;
  }
  return index;
}

function sourceOf(name, packsOrIndex) {
  var index = Array.isArray(packsOrIndex) ? indexPacks(packsOrIndex) : packsOrIndex;
  return index[String(name).toLowerCase()] || 'antd';
}

/** antd groups its own icons by suffix; keep that behaviour for the built-in tab. */
function styleOf(name) {
  var n = name.toLowerCase();
  if (n.slice(-8) === 'outlined') return 'Outlined';
  if (n.slice(-6) === 'filled') return 'Filled';
  if (n.slice(-7) === 'twotone') return 'TwoTone';
  return 'Other';
}

/**
 * Build the tab model once per open, from the live registry.
 * Anything not claimed by a pack is Ant Design's, so an app with no packs still gets
 * exactly the picker it had before.
 */
function buildSources(registryNames, packs) {
  // Ant Design's tab is "whatever the packs did not claim", so an app with no packs gets
  // exactly the picker it had before. Pack tabs come from the manifests instead of the
  // registry, because the manifests keep readable casing.
  var index = indexPacks(packs); // built once, not once per name
  var antd = [];
  for (var i = 0; i < registryNames.length; i++) {
    if (sourceOf(registryNames[i], index) === 'antd') antd.push(registryNames[i]);
  }
  antd.sort();

  var sources = [{ key: 'antd', label: 'Ant Design', names: antd, common: null, styles: true }];
  packs.forEach(function (p) {
    sources.push({
      key: p.pack,
      label: p.label || p.pack,
      names: p.names || [],
      common: p.common && p.common.length ? p.common : null,
      styles: false,
    });
  });
  return sources;
}

/**
 * Decide what to paint. Returns the capped list plus the honest totals, so the UI can
 * say "showing 120 of 5130" instead of pretending the rest do not exist.
 */
function selectNames(source, query, style) {
  var pool = source.names;
  if (source.styles && style) {
    pool = pool.filter(function (n) { return styleOf(n) === style; });
  }
  var q = (query || '').trim().toLowerCase();
  var matched;
  if (!q) {
    // No query: curated set for packs, whole (style-filtered) list for antd.
    matched = source.common || pool;
  } else {
    matched = pool.filter(function (n) { return n.toLowerCase().indexOf(q) !== -1; });
  }
  return { shown: matched.slice(0, CAP), total: matched.length, capped: matched.length > CAP };
}

/* ------------------------------------------------------------------ component */

function createIconPicker(React, nb, packs, antdLib) {
  var Icon = nb.Icon;
  var Button = antdLib && antdLib.Button;
  var Popover = antdLib && antdLib.Popover;
  var Input = antdLib && antdLib.Input;
  var Empty = antdLib && antdLib.Empty;

  function IconGrid(props) {
    var items = props.items;
    var cells = [];
    for (var i = 0; i < items.length; i++) {
      (function (name) {
        cells.push(
          React.createElement(
            'span',
            {
              key: name,
              title: name,
              onClick: function () { props.onPick(name); },
              style: {
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 30,
                height: 30,
                margin: 1,
                borderRadius: 6,
                cursor: 'pointer',
                fontSize: 18,
              },
              onMouseEnter: function (e) { e.currentTarget.style.background = 'rgba(0,0,0,.06)'; },
              onMouseLeave: function (e) { e.currentTarget.style.background = 'transparent'; },
            },
            React.createElement(Icon, { type: name })
          )
        );
      })(items[i]);
    }
    return React.createElement(
      'div',
      { style: { display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', height: '15em', overflowY: 'auto' } },
      cells
    );
  }

  function Tab(props) {
    return React.createElement(
      'span',
      {
        onClick: props.onClick,
        style: {
          padding: '3px 10px',
          marginInlineEnd: 6,
          borderRadius: 6,
          cursor: 'pointer',
          fontSize: 12,
          whiteSpace: 'nowrap',
          border: '1px solid ' + (props.active ? '#1677ff' : 'transparent'),
          color: props.active ? '#1677ff' : 'inherit',
          background: props.active ? 'rgba(22,119,255,.08)' : 'transparent',
        },
      },
      props.label
    );
  }

  function IconPacksPicker(props) {
    var value = props.value;
    var onChange = props.onChange;
    var disabled = props.disabled;
    var searchable = props.searchable !== false;

    var openState = React.useState(false);
    var open = openState[0], setOpen = openState[1];
    var qState = React.useState('');
    var query = qState[0], setQuery = qState[1];
    var srcState = React.useState('antd');
    var srcKey = srcState[0], setSrcKey = srcState[1];
    var styleState = React.useState('Outlined');
    var style = styleState[0], setStyle = styleState[1];

    // Read the registry when the popover opens, not on every render.
    var sources = React.useMemo(
      function () {
        if (!open) return [];
        var names = [];
        try { names = Array.from(nb.icons.keys()); } catch (e) { names = []; }
        // The registry lower-cases its keys; the manifests carry the display casing.
        return buildSources(names, packs);
      },
      [open]
    );

    var source = null;
    for (var i = 0; i < sources.length; i++) if (sources[i].key === srcKey) source = sources[i];
    if (!source && sources.length) source = sources[0];

    var picked = source ? selectNames(source, query, style) : { shown: [], total: 0, capped: false };

    function choose(name) {
      if (onChange) onChange(name);
      if (props.onChangeComplete) props.onChangeComplete(name);
      setOpen(false);
      setQuery('');
    }

    var content = React.createElement(
      'div',
      { style: { width: '26em' } },
      searchable
        ? React.createElement(Input, {
            allowClear: true,
            placeholder: 'Search ' + (source ? source.label : ''),
            value: query,
            onChange: function (e) { setQuery(e.target.value); },
            style: { marginBottom: 8 },
          })
        : null,
      React.createElement(
        'div',
        { style: { display: 'flex', flexWrap: 'wrap', marginBottom: 6 } },
        sources.map(function (s) {
          // Deliberately no count: how many icons a pack holds is the plugin's business,
          // not the person choosing one. The tab is a place to look, not a statistic.
          return React.createElement(Tab, {
            key: s.key,
            label: s.label,
            active: s.key === srcKey,
            onClick: function () { setSrcKey(s.key); },
          });
        })
      ),
      source && source.styles
        ? React.createElement(
            'div',
            { style: { display: 'flex', marginBottom: 6 } },
            ['Outlined', 'Filled', 'TwoTone'].map(function (st) {
              return React.createElement(Tab, {
                key: st,
                label: st,
                active: st === style,
                onClick: function () { setStyle(st); },
              });
            })
          )
        : null,
      picked.shown.length
        ? React.createElement(IconGrid, { items: picked.shown, onPick: choose })
        : React.createElement(Empty, { image: Empty.PRESENTED_IMAGE_SIMPLE, description: 'No icons' }),
      /**
       * The footer carries no totals either — but it must still say when the list is
       * truncated. Silently showing the first slice would make people think an icon is
       * missing when it is only further down the results.
       */
      React.createElement(
        'div',
        { style: { fontSize: 11, opacity: 0.6, marginTop: 6 } },
        picked.capped
          ? 'More matches than shown — refine the search'
          : (!query && source && source.common ? 'Common icons — search for more' : '')
      )
    );

    var trigger = value
      ? React.createElement(
          'span',
          { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
          React.createElement(Button, { disabled: disabled, onClick: function () { setOpen(!open); } },
            React.createElement(Icon, { type: value })),
          React.createElement(Button, {
            type: 'text',
            size: 'small',
            disabled: disabled,
            onClick: function (e) { e.stopPropagation(); if (onChange) onChange(null); },
          }, '×')
        )
      : React.createElement(Button, { disabled: disabled, onClick: function () { setOpen(!open); } }, 'Select icon');

    return React.createElement(
      Popover,
      {
        open: open && !disabled,
        onOpenChange: function (o) { if (!disabled) setOpen(o); },
        trigger: 'click',
        placement: 'bottom',
        content: content,
        destroyTooltipOnHide: true,
      },
      trigger
    );
  }
  IconPacksPicker.displayName = 'IconPacksPicker';
  return IconPacksPicker;
}

module.exports = {
  CAP: CAP,
  indexPacks: indexPacks,
  sourceOf: sourceOf,
  styleOf: styleOf,
  buildSources: buildSources,
  selectNames: selectNames,
  createIconPicker: createIconPicker,
};
