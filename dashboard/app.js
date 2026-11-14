/* Token Radar dashboard: renders window.RADAR (written by main.ts) with no network.
   Sortable + filterable board, a detail view for every protocol, and a separate
   "already trading" table. State lives in the URL hash so a view can be linked:
   #detail=<slug> opens a protocol, #cat=<category> filters, #q=<text> searches. */
(function () {
  'use strict';
  var D = window.RADAR;
  if (!D || !D.rows) { document.body.innerHTML = '<p style="padding:30px">No radar data was loaded.</p>'; return; }

  var $ = function (id) { return document.getElementById(id); };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function pct(n) {
    if (n == null) return '<span class="flat">n/a</span>';
    var cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (n > 0 ? '+' : '') + n.toFixed(1) + '%</span>';
  }
  function age(n) { return n == null ? 'n/a' : n >= 365 ? (n / 365).toFixed(1) + 'y' : n + 'd'; }
  function chains(c) { return c && c.length ? esc(c.slice(0, 3).join(', ')) + (c.length > 3 ? ' +' + (c.length - 3) : '') : '—'; }

  /* ---- header stats ---- */
  $('asof').textContent = D.as_of;
  var top = D.rows[0];
  $('stats').innerHTML =
    '<div><dt>Board rows</dt><dd>' + D.board_size + '</dd></div>' +
    '<div><dt>Watchlist covered</dt><dd>' + D.watchlist_size + ' / ' + D.watchlist_size + '</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + D.early_size + '</dd></div>' +
    '<div><dt>Top implied value</dt><dd>' + money(top ? top.implied_value_usd : 0) + '</dd></div>' +
    '<div><dt>Watchlist floor</dt><dd>' + money(D.floor_usd) + '</dd></div>';

  /* ---- category filter options ---- */
  var cats = {};
  D.rows.forEach(function (r) { cats[r.category || 'Uncategorised'] = 1; });
  var catSel = $('cat');
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o);
  });

  /* ---- state ---- */
  var state = { q: '', cat: '', watch: false, sort: 'value', detail: null };
  function readHash() {
    var h = location.hash.replace(/^#/, '');
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      if (kv.length === 2) state[{ detail: 'detail', cat: 'cat', q: 'q' }[kv[0]] || kv[0]] = decodeURIComponent(kv[1]);
    });
  }
  function writeHash() {
    var parts = [];
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : '#');
  }

  /* ---- filtering + sorting ---- */
  function visible() {
    var q = state.q.trim().toLowerCase();
    var rows = D.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && (r.category || 'Uncategorised') !== state.cat) return false;
      if (q && (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var k = state.sort;
    var cmp = {
      value: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); },
      age: function (a, b) { return (b.age_days || 0) - (a.age_days || 0); },
      name: function (a, b) { return a.name < b.name ? -1 : 1; }
    }[k] || function (a, b) { return a.rank - b.rank; };
    return rows.slice().sort(cmp);
  }

  function render() {
    var rows = visible();
    $('count').textContent = rows.length + ' of ' + D.rows.length + ' protocols';
    $('empty').hidden = rows.length > 0;
    $('rows').innerHTML = rows.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.detail === r.slug ? ' class="sel"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span><br><span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td><span class="cat">' + esc(r.category || 'Uncategorised') + '</span></td>' +
        '<td>' + chains(r.chains) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + age(r.age_days) + '</td>' +
        '<td class="num val">' + money(r.implied_value_usd) + '</td></tr>';
    }).join('');
    renderDetail();
  }

  /* ---- detail view ---- */
  function bar(label, mult, max) {
    var w = Math.max(4, Math.min(100, (mult / max) * 100));
    return '<div><span>' + label + '</span><span class="bar"><i style="width:' + w.toFixed(0) + '%"></i></span><b>&times;' + mult.toFixed(2) + '</b></div>';
  }
  function renderDetail() {
    var box = $('detail');
    var r = null;
    if (state.detail) for (var i = 0; i < D.rows.length; i++) if (D.rows[i].slug === state.detail) { r = D.rows[i]; break; }
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML =
      '<h2>#' + r.rank + ' &mdash; ' + esc(r.name) + '</h2>' +
      '<p class="sub">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'Uncategorised') + ' &middot; runs on ' + esc(r.chains.join(', ') || 'one chain') +
      ' &middot; records no token &middot; listed ' + (r.listed_at || 'on an unreported date') + '</p>' +
      '<dl class="grid">' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>TVL</dt><dd>' + money(r.tvl_usd) + '</dd></div>' +
      '<div><dt>7-day change</dt><dd>' + (r.change_7d == null ? 'n/a' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(2) + '%') + '</dd></div>' +
      '<div><dt>Age</dt><dd>' + age(r.age_days) + '</dd></div>' +
      '<div><dt>Sector multiple</dt><dd>&times;' + r.sector_multiple.toFixed(2) + '</dd></div>' +
      '</dl>' +
      '<div class="bars">' + bar('Sector', r.sector_multiple, 0.32) + bar('Growth', r.growth_multiplier, 2.2) +
      bar('Maturity', r.maturity_multiplier, 1) + bar('Breadth', r.breadth_multiplier, 1.15) + '</div>' +
      '<p class="note">Implied value = TVL &times; sector &times; growth &times; maturity &times; breadth = ' +
      money(r.tvl_usd) + ' &times; ' + r.sector_multiple.toFixed(2) + ' &times; ' + r.growth_multiplier.toFixed(2) +
      ' &times; ' + r.maturity_multiplier.toFixed(2) + ' &times; ' + r.breadth_multiplier.toFixed(2) +
      ' = <b>' + money(r.implied_value_usd) + '</b>. This entry&rsquo;s own claim, not a prediction.</p>' +
      '<h3>How to farm ' + esc(r.name) + '</h3>' +
      '<ol>' + r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<button class="close" id="closedetail">Close detail</button>';
    $('closedetail').addEventListener('click', function () { state.detail = null; writeHash(); render(); });
  }

  /* ---- already-trading table ---- */
  $('live-rows').innerHTML = D.live.map(function (p) {
    return '<tr><td><span class="name">' + esc(p.name) + '</span><br><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td><span class="cat">' + esc(p.category || 'Uncategorised') + '</span></td>' +
      '<td>' + chains(p.chains) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  /* ---- events ---- */
  $('q').addEventListener('input', function (e) { state.q = e.target.value; writeHash(); render(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; writeHash(); render(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; render(); });
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (!tr) return;
    state.detail = state.detail === tr.getAttribute('data-slug') ? null : tr.getAttribute('data-slug');
    writeHash(); render();
    if (state.detail) $('detail').scrollIntoView({ block: 'nearest' });
  });
  document.querySelectorAll('#board thead th[data-k]').forEach(function (th) {
    th.addEventListener('click', function () {
      var map = { rank: 'value', name: 'name', category: 'value', tvl: 'tvl', growth: 'growth', age: 'age', value: 'value' };
      state.sort = map[th.getAttribute('data-k')] || 'value';
      $('sort').value = state.sort; render();
    });
  });

  /* ---- init from hash ---- */
  readHash();
  if (state.q) $('q').value = state.q;
  if (state.cat) catSel.value = state.cat;
  render();
})();
