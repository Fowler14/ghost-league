/* Ghost League — static site. Data comes from data/schedule.js (window.GHOST_DATA).
   Score edits and team-name fixes live in localStorage until you Export a new data file. */
(function () {
  'use strict';

  var STORE = 'ghostLeague.v1';
  var DATA = JSON.parse(JSON.stringify(window.GHOST_DATA));
  var BOX = window.GHOST_BOX || null;   // data/boxscores.js — ESPN rosters, points, NFL games
  var TEAM = {};      // id -> team object (with .league)
  var GAMES = [];     // flat list of every game, with .week
  var editing = false;
  var MANUAL = {};    // game id -> true, for scores typed by hand (these beat ESPN)
  var standingsMode = 'overall';

  /* ---------- data plumbing ---------- */

  function index() {
    TEAM = {}; GAMES = [];
    ['fowler', 'kyle'].forEach(function (lg) {
      DATA.leagues[lg].teams.forEach(function (t) { t.league = lg; TEAM[t.id] = t; });
    });
    DATA.weeks.forEach(function (w) {
      w.games.forEach(function (g) { g.week = w.week; GAMES.push(g); });
    });
    applyEspnNames();
    applyEspnScores();
  }

  /* ESPN knows the full team names the screenshots truncated. Use them when we have them —
     a manual rename in loadLocal() still wins, because that runs after this. */
  function applyEspnNames() {
    if (!BOX) return;
    ['fowler', 'kyle'].forEach(function (lg) {
      var info = BOX.leagues && BOX.leagues[lg];
      if (!info || !info.connected) return;
      Object.keys(info.names || {}).forEach(function (id) {
        if (TEAM[id] && info.names[id]) TEAM[id].name = info.names[id];
      });
      Object.keys(info.abbrevs || {}).forEach(function (id) {
        if (TEAM[id] && info.abbrevs[id]) TEAM[id].abbrev = info.abbrevs[id];
      });
    });
  }

  /* Weekly totals come from ESPN once a team's starters have actually kicked off.
     Anything typed by hand in the score editor overrides this (loadLocal runs later). */
  function applyEspnScores() {
    if (!BOX) return;
    GAMES.forEach(applyEspnScore);
  }

  function applyEspnScore(g) {
    if (!BOX) return;
    var wk = BOX.weeks && BOX.weeks[g.week];
    if (!wk) return;
    ['fowler', 'kyle'].forEach(function (lg) {
      var t = wk.teams[g[lg]];
      if (t && typeof t.total === 'number' && teamKickedOff(g.week, t)) g[lg + '_score'] = t.total;
    });
  }

  function teamKickedOff(week, t) {
    return (t.players || []).some(function (p) {
      if (!p.starter) return false;
      var ng = nflGame(week, p.nfl);
      return ng && ng.state !== 'pre';
    });
  }

  function loadLocal() {
    var raw;
    try { raw = localStorage.getItem(STORE); } catch (e) { return; }
    if (!raw) return;
    var saved;
    try { saved = JSON.parse(raw); } catch (e) { return; }
    if (saved.scores) {
      GAMES.forEach(function (g) {
        var s = saved.scores[g.id];
        if (s) { g.fowler_score = s[0]; g.kyle_score = s[1]; MANUAL[g.id] = true; }
      });
    }
    if (saved.teams) {
      Object.keys(saved.teams).forEach(function (id) {
        if (!TEAM[id]) return;
        if (saved.teams[id].name) TEAM[id].name = saved.teams[id].name;
        if (saved.teams[id].manager) TEAM[id].manager = saved.teams[id].manager;
      });
    }
  }

  function saveLocal() {
    var scores = {}, teams = {};
    GAMES.forEach(function (g) {
      if (MANUAL[g.id] && (g.fowler_score !== null || g.kyle_score !== null))
        scores[g.id] = [g.fowler_score, g.kyle_score];
    });
    var orig = window.GHOST_DATA.leagues;
    ['fowler', 'kyle'].forEach(function (lg) {
      orig[lg].teams.forEach(function (o) {
        var t = TEAM[o.id];
        if (t.name !== o.name || t.manager !== o.manager)
          teams[o.id] = { name: t.name, manager: t.manager };
      });
    });
    try {
      localStorage.setItem(STORE, JSON.stringify({ scores: scores, teams: teams }));
    } catch (e) { /* private mode — edits stay in memory for this session */ }
    noteStore();
  }

  function noteStore() {
    var n = GAMES.filter(played).length;
    var el = document.getElementById('storeNote');
    if (el) el.textContent = n
      ? n + ' of 140 matchups scored. Edits are saved in this browser only — use Export on the Schedule tab to write them into data/schedule.js.'
      : 'No scores entered yet. Open the Schedule tab and click "Enter scores".';
  }

  function played(g) {
    return typeof g.fowler_score === 'number' && typeof g.kyle_score === 'number';
  }

  /* ---------- computed tables ---------- */

  function rowFor(t) { var r = teamStats(t.id); r.team = t; return r; }
  function bySeed(a, b) {
    return b.pts - a.pts || b.pf - a.pf || a.team.name.localeCompare(b.team.name);
  }
  function standings(lg) { return DATA.leagues[lg].teams.map(rowFor).sort(bySeed); }
  function overall() {
    return DATA.leagues.fowler.teams.concat(DATA.leagues.kyle.teams).map(rowFor).sort(bySeed);
  }
  function rankIn(rows, id) {
    for (var i = 0; i < rows.length; i++) if (rows[i].team.id === id) return i + 1;
    return 0;
  }

  function teamGames(id) {
    var lg = TEAM[id].league;
    return GAMES.filter(function (g) { return g[lg] === id; })
                .sort(function (a, b) { return a.week - b.week; });
  }

  function teamStats(id) {
    var lg = TEAM[id].league, s = { pts: 0, w: 0, l: 0, t: 0, pf: 0, pa: 0, gp: 0 };
    teamGames(id).forEach(function (g) {
      if (!played(g)) return;
      var mine = lg === 'fowler' ? g.fowler_score : g.kyle_score;
      var opp  = lg === 'fowler' ? g.kyle_score : g.fowler_score;
      s.gp++; s.pf += mine; s.pa += opp;
      if (mine > opp) { s.w++; s.pts += 1; } else if (mine < opp) { s.l++; } else { s.t++; s.pts += 0.5; }
    });
    return s;
  }

  function leagueTally() {
    var f = 0, k = 0, tie = 0;
    GAMES.forEach(function (g) {
      if (!played(g)) return;
      if (g.fowler_score > g.kyle_score) f++;
      else if (g.fowler_score < g.kyle_score) k++;
      else tie++;
    });
    return { f: f, k: k, tie: tie };
  }

  function currentWeek() {
    var today = new Date(); today.setHours(0, 0, 0, 0);
    for (var i = 0; i < DATA.weeks.length; i++) {
      var end = new Date(DATA.weeks[i].end + 'T23:59:59');
      if (today <= end) return DATA.weeks[i].week;
    }
    return DATA.weeks.length;
  }

  function weekOf(n) {
    return DATA.weeks.filter(function (w) { return w.week === n; })[0];
  }

  /* ---------- ESPN box score helpers ---------- */

  function boxFor(id, week) {
    var wk = BOX && BOX.weeks && BOX.weeks[week];
    return (wk && wk.teams[id]) || null;
  }

  function hasBox(g) { return !!(boxFor(g.fowler, g.week) || boxFor(g.kyle, g.week)); }

  function nflGame(week, abbrev) {
    var list = (BOX && BOX.nfl && BOX.nfl[week]) || [];
    if (!abbrev) return null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].home === abbrev || list[i].away === abbrev) return list[i];
    }
    return null;
  }

  /* "SF" when at home, "@SEA" when away — same as ESPN's OPP column. */
  function oppText(week, abbrev) {
    var ng = nflGame(week, abbrev);
    if (!ng) return '<span class="dim">—</span>';
    return ng.home === abbrev ? esc(ng.away) : '@' + esc(ng.home);
  }

  function statusText(week, abbrev) {
    var ng = nflGame(week, abbrev);
    if (!ng) return '<span class="dim">—</span>';
    var home = ng.home === abbrev;
    var mine = home ? ng.homeScore : ng.awayScore;
    var them = home ? ng.awayScore : ng.homeScore;
    if (ng.state === 'post') {
      var r = mine > them ? 'W' : (mine < them ? 'L' : 'T');
      return '<span class="' + (r === 'W' ? 'res-w' : r === 'L' ? 'res-l' : 'dim') + '">' +
             r + ' ' + mine + '-' + them + '</span>';
    }
    if (ng.state === 'in') {
      return '<span class="res-live">' + esc(ng.detail || (mine + '-' + them)) + '</span>';
    }
    return '<span class="dim">' + esc(ng.detail || 'Scheduled') + '</span>';
  }

  /* Live header numbers, the way ESPN frames them. */
  function boxMeta(week, box) {
    var m = { playing: 0, yet: 0, mins: 0, proj: 0 };
    (box.players || []).forEach(function (p) {
      if (!p.starter) return;
      var ng = nflGame(week, p.nfl);
      var state = ng ? ng.state : 'pre';
      if (state === 'in') m.playing++;
      else if (state === 'pre') m.yet++;
      if (ng) m.mins += ng.minsLeft;
      // Final players count what they scored; everyone else counts their projection.
      m.proj += state === 'post' ? (p.fpts || 0) : (p.proj || 0);
    });
    m.proj = Math.round(m.proj * 10) / 10;
    m.mins = Math.round(m.mins);
    return m;
  }

  /* ---------- helpers ---------- */

  function el(html) { var d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstChild; }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function num(n, d) { return n === null || n === undefined ? '—' : Number(n).toFixed(d === undefined ? 1 : d); }
  function pts(n) { return n % 1 === 0 ? String(n) : n.toFixed(1); }
  function fp(n) {
    if (n === null || n === undefined) return '—';
    var r = Math.round(n * 100) / 100;
    return Math.round(r * 10) === r * 10 ? r.toFixed(1) : r.toFixed(2);
  }
  function rec(s) { return s.t ? s.w + '-' + s.l + '-' + s.t : s.w + '-' + s.l; }

  /* Render one matchup row. Home team on the left. */
  function matchRow(g, opts) {
    opts = opts || {};
    var homeIsF = g.home === 'fowler';
    var fT = TEAM[g.fowler], kT = TEAM[g.kyle];
    var L = homeIsF ? { t: fT, lg: 'fowler', s: g.fowler_score } : { t: kT, lg: 'kyle', s: g.kyle_score };
    var R = homeIsF ? { t: kT, lg: 'kyle', s: g.kyle_score } : { t: fT, lg: 'fowler', s: g.fowler_score };
    var done = played(g), lw = '', rw = '';
    if (done) {
      if (L.s > R.s) { lw = 'win'; rw = 'lose'; }
      else if (R.s > L.s) { rw = 'win'; lw = 'lose'; }
    }
    function side(o, cls, extra) {
      return '<div class="side ' + extra + ' ' + cls + '">' +
        '<a class="tname" href="#/team/' + o.t.id + '">' + esc(o.t.name) + '</a>' +
        '<span class="tmgr"><span class="pill ' + (o.lg === 'fowler' ? 'f' : 'k') + '">' +
        (o.lg === 'fowler' ? 'F' : 'K') + '</span> ' + esc(o.t.manager) + '</span></div>';
    }
    var mid;
    if (opts.edit) {
      mid = '<div class="mid edit"><input type="number" step="0.01" placeholder="0.0" data-g="' + g.id +
            '" data-side="' + L.lg + '" value="' + (L.s === null ? '' : L.s) + '">' +
            '<input type="number" step="0.01" placeholder="0.0" data-g="' + g.id +
            '" data-side="' + R.lg + '" value="' + (R.s === null ? '' : R.s) + '"></div>';
    } else if (done || typeof L.s === 'number' || typeof R.s === 'number') {
      // One league can be synced while the other is not — show the half we know.
      var part = done ? '' : ' part';
      mid = '<div class="mid"><span class="score' + part + '">' +
            (typeof L.s === 'number' ? fp(L.s) : '—') + '</span>' +
            '<span class="vs"> – </span><span class="score' + part + '">' +
            (typeof R.s === 'number' ? fp(R.s) : '—') + '</span></div>';
    } else {
      mid = '<div class="mid"><span class="vs">vs</span></div>';
    }
    var linked = !opts.edit && !opts.nolink && hasBox(g);
    if (linked) {
      mid = mid.replace('</div>', '<span class="boxhint">Box score &rsaquo;</span></div>');
    }
    return '<div class="match' + (linked ? ' clickable' : '') + '"' +
      (linked ? ' data-go="#/game/' + g.id + '"' : '') + '>' +
      side(L, lw, '') + mid + side(R, rw, 'away') + '</div>';
  }

  function weekPicker(sel, onChange) {
    var o = DATA.weeks.map(function (w) {
      return '<option value="' + w.week + '"' + (w.week === sel ? ' selected' : '') + '>Week ' + w.week +
        ' · ' + w.label + (w.rematch_of ? ' · rematch' : '') + '</option>';
    }).join('');
    var s = el('<select>' + o + '</select>');
    s.addEventListener('change', function () { onChange(+s.value); });
    return s;
  }

  /* ---------- views ---------- */

  var view = document.getElementById('view');

  function vScoreboard() {
    var wk = weekOf(currentWeek());
    var t = leagueTally(), tot = t.f + t.k + t.tie, fp = tot ? (t.f / tot) * 100 : 50;
    var h = '<div class="head"><div><h2>Week ' + wk.week + ' Scoreboard</h2>' +
      '<p class="nowk">' + wk.label + (wk.rematch_of ? ' · rematches of Week ' + wk.rematch_of : '') + '</p></div>' +
      '<a href="#/schedule"><button>Browse all weeks</button></a></div>';

    h += '<div class="banner"><div><h3 style="margin:0 0 6px">League vs League</h3>' +
      '<div class="tally"><span style="color:var(--fowler)">Fowler ' + t.f + '</span>' +
      '<span class="dim" style="font-weight:400">—</span>' +
      '<span style="color:var(--kyle)">' + t.k + ' Kyle</span>' +
      (t.tie ? '<span class="dim" style="font-size:13px;font-weight:400">(' + t.tie + ' tied)</span>' : '') +
      '</div></div><div class="bar"><i class="bf" style="width:' + fp + '%"></i><i class="bk" style="width:' + (100 - fp) + '%"></i></div></div>';

    var lb = overall();
    if (lb.some(function (r) { return r.gp; })) {
      h += '<div class="banner"><div><h3 style="margin:0 0 6px">Ghost League Leaders</h3>' +
        '<div class="leaders">' + lb.slice(0, 3).map(function (r, i) {
          return '<a class="ldr" href="#/team/' + r.team.id + '"><b>' + (i + 1) + '.</b> ' +
            esc(r.team.name) + '<span class="pill ' + (r.team.league === 'fowler' ? 'f' : 'k') + '">' +
            esc(DATA.leagues[r.team.league].short) + '</span>' +
            '<em>' + pts(r.pts) + ' pts</em></a>';
        }).join('') + '</div></div>' +
        '<a href="#/standings"><button>Full leaderboard</button></a></div>';
    }
    h += '<div class="card">' + wk.games.map(function (g) { return matchRow(g); }).join('') + '</div>';
    if (BOX && BOX.updated) {
      h += '<p class="synced">' + syncNote() + '</p>';
    }
    view.innerHTML = h;
    wireGo();
  }

  function vSchedule(wkNum) {
    var n = wkNum || currentWeek(), wk = weekOf(n);
    view.innerHTML = '<div class="head"><div><h2>Schedule</h2>' +
      '<p class="nowk">10 cross-league matchups every week</p></div>' +
      '<div class="btnrow" id="ctl"></div></div>' +
      (editing ? '<div class="editnote">Enter each team\'s fantasy points from your ESPN screenshots. Saved to this browser as you type — then <b>Export data file</b> and drop it into <code>data/schedule.js</code> to make it permanent.</div>' : '') +
      '<div class="card"><div style="padding:12px 16px;border-bottom:1px solid var(--line)" class="muted">' +
      'Week ' + wk.week + ' · ' + wk.label + (wk.rematch_of ? ' · <span class="pill re">Rematch of wk ' + wk.rematch_of + '</span>' : '') +
      '</div>' + wk.games.map(function (g) { return matchRow(g, { edit: editing }); }).join('') + '</div>';

    var ctl = document.getElementById('ctl');
    ctl.appendChild(weekPicker(n, function (v) { location.hash = '#/schedule/' + v; }));
    var b = el('<button class="' + (editing ? 'primary' : '') + '">' + (editing ? 'Done editing' : 'Enter scores') + '</button>');
    b.onclick = function () { editing = !editing; vSchedule(n); };
    ctl.appendChild(b);
    var x = el('<button class="ghostbtn">Export data file</button>');
    x.onclick = exportData; ctl.appendChild(x);

    if (!editing) wireGo();

    if (editing) {
      view.querySelectorAll('input[data-g]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          var g = GAMES.filter(function (q) { return q.id === inp.dataset.g; })[0];
          var v = inp.value.trim();
          g[inp.dataset.side + '_score'] = v === '' ? null : parseFloat(v);
          var other = view.querySelector('input[data-g="' + g.id + '"][data-side="' +
            (inp.dataset.side === 'fowler' ? 'kyle' : 'fowler') + '"]');
          if (v === '' && (!other || other.value.trim() === '')) {
            // Both cleared — stop overriding and let ESPN supply this matchup again.
            delete MANUAL[g.id];
            g.fowler_score = null; g.kyle_score = null;
            applyEspnScore(g);
            if (other) other.value = g[other.dataset.side + '_score'] === null ? '' : g[other.dataset.side + '_score'];
            inp.value = g[inp.dataset.side + '_score'] === null ? '' : g[inp.dataset.side + '_score'];
          } else {
            MANUAL[g.id] = true;
          }
          saveLocal();
        });
      });
    }
  }

  function vStandings() {
    var rows = overall(), any = rows.some(function (r) { return r.gp; });
    var lead = rows[0];

    var head = '<div class="head"><div><h2>Ghost League Leaderboard</h2>' +
      '<p class="nowk">All 20 teams, both leagues, one title &middot; 1 League Point per weekly win &middot; 14 possible</p></div>' +
      '<div class="toggle" id="tg">' +
      '<button data-m="overall" class="' + (standingsMode === 'overall' ? 'on' : '') + '">Overall</button>' +
      '<button data-m="league" class="' + (standingsMode === 'league' ? 'on' : '') + '">By league</button>' +
      '</div></div>';

    if (any && standingsMode === 'overall') {
      head += '<div class="banner leadbar"><div><h3 style="margin:0 0 4px">Currently leading</h3>' +
        '<div class="tally"><span class="crown">&#127942;</span>' + esc(lead.team.name) +
        '<span class="pill ' + (lead.team.league === 'fowler' ? 'f' : 'k') + '">' +
        esc(DATA.leagues[lead.team.league].short) + '</span></div>' +
        '<p class="nowk" style="margin:4px 0 0">' + esc(lead.team.manager) + ' &middot; ' +
        pts(lead.pts) + ' League Points &middot; ' + num(lead.pf) + ' points scored</p></div></div>';
    }

    if (standingsMode === 'league') {
      view.innerHTML = head + '<div class="grid2">' + leagueTable('fowler') + leagueTable('kyle') + '</div>';
    } else {
      var body = rows.map(function (r, i) {
        var lgc = r.team.league === 'fowler' ? 'f' : 'k';
        return '<tr class="clickable' + (any && i === 0 ? ' lead' : '') + '" data-go="#/team/' + r.team.id + '">' +
          '<td class="rank">' + (i + 1) + '</td>' +
          '<td class="tm">' + esc(r.team.name) +
          '<span class="pill ' + lgc + '">' + esc(DATA.leagues[r.team.league].short) + '</span>' +
          '<small>' + esc(r.team.manager) + '</small></td>' +
          '<td class="big">' + pts(r.pts) + '</td>' +
          '<td class="hide-sm">' + rec(r) + '</td>' +
          '<td>' + num(r.pf) + '</td>' +
          '<td class="hide-sm">' + num(r.pa) + '</td></tr>';
      }).join('');
      view.innerHTML = head + '<div class="card"><table><thead><tr><th></th><th>Team</th>' +
        '<th title="League Points — 1 per weekly win">Pts</th><th class="hide-sm">Rec</th>' +
        '<th>PF</th><th class="hide-sm">PA</th></tr></thead><tbody>' + body + '</tbody></table></div>';
    }

    document.getElementById('tg').addEventListener('click', function (e) {
      if (!e.target.dataset.m) return;
      standingsMode = e.target.dataset.m;
      vStandings();
    });
    wireGo();
  }

  function leagueTable(lg) {
    var rows = standings(lg).map(function (r, i) {
      return '<tr class="clickable" data-go="#/team/' + r.team.id + '">' +
        '<td class="rank">' + (i + 1) + '</td>' +
        '<td class="tm">' + esc(r.team.name) + '<small>' + esc(r.team.manager) + '</small></td>' +
        '<td class="big">' + pts(r.pts) + '</td>' +
        '<td class="hide-sm">' + rec(r) + '</td>' +
        '<td>' + num(r.pf) + '</td>' +
        '<td class="hide-sm">' + num(r.pa) + '</td></tr>';
    }).join('');
    return '<div class="card"><div class="pad" style="padding-bottom:0">' +
      '<h3 style="color:var(--' + lg + ')">' + esc(DATA.leagues[lg].name) + '</h3></div>' +
      '<table><thead><tr><th></th><th>Team</th><th>Pts</th>' +
      '<th class="hide-sm">Rec</th><th>PF</th><th class="hide-sm">PA</th></tr></thead><tbody>' +
      rows + '</tbody></table></div>';
  }

  function vLeague(lg) {
    var L = DATA.leagues[lg];
    var cards = L.teams.map(function (t) {
      return '<div class="tcard" data-go="#/team/' + t.id + '">' +
        '<div class="ab">' + esc(t.abbrev) + '</div><div style="min-width:0">' +
        '<b>' + esc(t.name) + '</b><span>' + esc(t.manager) + '</span></div></div>';
    }).join('');
    view.innerHTML = '<div class="head"><div><h2 style="color:var(--' + lg + ')">' + esc(L.name) + '</h2>' +
      '<p class="nowk">Pick your team to see its full schedule, points and next matchup</p></div>' +
      '<div class="btnrow" id="ctl"></div></div>' +
      (editing ? '<div class="editnote">Team names and managers are editable below. Fix any that ESPN cut off, then <b>Export data file</b> from the Schedule tab.</div>' : '') +
      '<div class="tgrid">' + cards + '</div>' +
      (editing ? editTeams(lg) : '');

    var b = el('<button class="' + (editing ? 'primary' : 'ghostbtn') + '">' + (editing ? 'Done editing' : 'Edit team names') + '</button>');
    b.onclick = function () { editing = !editing; vLeague(lg); };
    document.getElementById('ctl').appendChild(b);

    if (editing) {
      view.querySelectorAll('input[data-t]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          TEAM[inp.dataset.t][inp.dataset.f] = inp.value;
          saveLocal();
        });
      });
    } else wireGo();
  }

  function editTeams(lg) {
    return '<div class="card" style="margin-top:18px"><table><thead><tr><th>Team name</th><th>Manager</th></tr></thead><tbody>' +
      DATA.leagues[lg].teams.map(function (t) {
        return '<tr><td><input data-t="' + t.id + '" data-f="name" value="' + esc(t.name) +
          '" style="width:100%;padding:6px 8px;background:#12151d;border:1px solid var(--line);border-radius:6px;color:var(--ink)"></td>' +
          '<td><input data-t="' + t.id + '" data-f="manager" value="' + esc(t.manager) +
          '" style="width:100%;padding:6px 8px;background:#12151d;border:1px solid var(--line);border-radius:6px;color:var(--ink)"></td></tr>';
      }).join('') + '</tbody></table></div>';
  }

  function vTeam(id) {
    var t = TEAM[id];
    if (!t) { view.innerHTML = '<p class="empty">Team not found.</p>'; return; }
    var lg = t.league, opp = lg === 'fowler' ? 'kyle' : 'fowler';
    var s = teamStats(id), gs = teamGames(id);
    var oRank = rankIn(overall(), id), lRank = rankIn(standings(lg), id);

    var next = gs.filter(function (g) { return !played(g); })[0];

    var rows = gs.map(function (g) {
      var o = TEAM[g[opp]];
      var mine = lg === 'fowler' ? g.fowler_score : g.kyle_score;
      var them = lg === 'fowler' ? g.kyle_score : g.fowler_score;
      var res = '<span class="dim">—</span>', sc = '<span class="dim">—</span>';
      if (played(g)) {
        var wl = mine > them ? 'W' : (mine < them ? 'L' : 'T');
        res = '<b style="color:var(--' + (wl === 'W' ? 'win' : wl === 'L' ? 'loss' : 'muted') + ')">' + wl + '</b>';
        sc = num(mine) + ' – ' + num(them);
      }
      var wk = weekOf(g.week);
      return '<tr class="clickable" data-go="#/team/' + o.id + '">' +
        '<td class="rank">' + g.week + '</td>' +
        '<td class="tm">' + esc(o.name) + '<small>' + esc(o.manager) +
        (g.rematch ? ' · rematch' : '') + '</small></td>' +
        '<td class="hide-sm dim">' + wk.label + '</td>' +
        '<td>' + res + '</td><td>' + sc + '</td></tr>';
    }).join('');

    view.innerHTML = '<a class="back" href="#/league/' + lg + '">&larr; ' + esc(DATA.leagues[lg].name) + '</a>' +
      '<div class="head"><div><h2>' + esc(t.name) + '</h2>' +
      '<p class="nowk"><span class="pill ' + (lg === 'fowler' ? 'f' : 'k') + '">' +
      esc(DATA.leagues[lg].short) + '</span> ' + esc(t.manager) + ' · ' + esc(t.abbrev) + '</p></div></div>' +

      '<div class="stats">' +
      '<div class="stat"><div class="n">' + pts(s.pts) + '<span class="dim" style="font-size:15px">/14</span></div><div class="l">League Points</div></div>' +
      '<div class="stat"><div class="n">' + rec(s) + '</div><div class="l">Record</div></div>' +
      '<div class="stat"><div class="n">' + num(s.pf) + '</div><div class="l">Total Points For</div></div>' +
      '<div class="stat"><div class="n">' + num(s.pa) + '</div><div class="l">Points Against</div></div>' +
      '<div class="stat"><div class="n">' + (s.gp ? '#' + oRank : '—') +
      '<span class="dim" style="font-size:15px">/20</span></div>' +
      '<div class="l">Ghost League Rank' + (s.gp ? ' &middot; #' + lRank + ' in ' + esc(DATA.leagues[lg].short) : '') + '</div></div>' +
      '</div>' +

      (next ? '<div class="card" style="margin-bottom:18px">' +
        '<div style="padding:12px 16px;border-bottom:1px solid var(--line)" class="muted">Upcoming — Week ' +
        next.week + ' · ' + weekOf(next.week).label + '</div>' + matchRow(next) + '</div>'
        : '<div class="card" style="margin-bottom:18px"><div class="empty">Season complete — all 14 matchups played.</div></div>') +

      lineupCard(id) +

      '<div class="card"><div class="pad" style="padding-bottom:0"><h3>Full Schedule</h3></div>' +
      '<table><thead><tr><th>Wk</th><th>Opponent (' + esc(DATA.leagues[opp].name) + ')</th>' +
      '<th class="hide-sm">Dates</th><th>Res</th><th>Score</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    wireGo();
  }

  function syncNote() {
    var when = new Date(BOX.updated);
    var mins = Math.round((Date.now() - when.getTime()) / 60000);
    var ago = mins < 1 ? 'just now'
      : mins < 60 ? mins + ' min ago'
      : mins < 1440 ? Math.round(mins / 60) + ' hr ago'
      : Math.round(mins / 1440) + ' days ago';
    var off = ['fowler', 'kyle'].filter(function (lg) {
      return !(BOX.leagues[lg] && BOX.leagues[lg].connected);
    });
    var note = 'Player scores updated from ESPN ' + ago + '.';
    if (off.length) {
      note += ' Not connected: ' + off.map(function (lg) { return DATA.leagues[lg].name; }).join(', ') +
        ' — run tools/fetch-espn.mjs with credentials for ' + (off.length > 1 ? 'those leagues' : 'that league') + '.';
    }
    return note;
  }

  /* ---------- box score (ESPN-style, two rosters side by side) ---------- */

  function rosterTable(id, week, teamScore, bare) {
    var box = boxFor(id, week);
    var t = TEAM[id];
    var lgc = t.league === 'fowler' ? 'f' : 'k';
    var head = '<div class="pad bsCap"><span class="pill ' + lgc + '">' +
      esc(DATA.leagues[t.league].short) + '</span> <b>' + esc(t.name) + '</b> Box Score</div>';
    function wrap(inner) { return bare ? inner : '<div class="card">' + head + inner + '</div>'; }

    if (!box) {
      return wrap('<div class="empty">No ESPN data for this team yet.<br><span class="dim">' +
        (BOX && BOX.leagues[t.league] && BOX.leagues[t.league].connected
          ? 'The week has not been synced.'
          : esc(DATA.leagues[t.league].name) + ' is not connected to ESPN yet.') +
        '</span></div>');
    }

    function line(p) {
      var ng = nflGame(week, p.nfl);
      var notYet = !ng || ng.state === 'pre';
      return '<tr>' +
        '<td class="slot">' + esc(p.slot) + '</td>' +
        '<td class="ply"><b>' + esc(p.name) + (p.inj ? '<i class="inj">' + esc(p.inj) + '</i>' : '') +
        '</b><small>' + esc(p.nfl) + ' ' + esc(p.pos) + '</small></td>' +
        '<td class="opp hide-xs">' + oppText(week, p.nfl) + '</td>' +
        '<td class="st hide-sm">' + statusText(week, p.nfl) + '</td>' +
        '<td class="dim">' + num(p.proj) + '</td>' +
        '<td class="fp">' + (notYet ? '<span class="dim">—</span>' : fp(p.fpts)) + '</td></tr>';
    }

    var starters = (box.players || []).filter(function (p) { return p.starter; });
    var bench = (box.players || []).filter(function (p) { return !p.starter; });

    var body = starters.map(line).join('') +
      '<tr class="tot"><td></td><td>Starters</td><td class="hide-xs"></td><td class="hide-sm"></td>' +
      '<td>' + num(box.proj) + '</td><td class="fp">' + fp(teamScore === null ? box.total : teamScore) + '</td></tr>';

    if (bench.length) {
      body += '<tr class="sep"><td colspan="6">Bench</td></tr>' + bench.map(line).join('') +
        '<tr class="tot dim"><td></td><td>Bench</td><td class="hide-xs"></td><td class="hide-sm"></td>' +
        '<td>' + num(box.benchProj) + '</td><td>' + fp(box.benchTotal) + '</td></tr>';
    }

    return wrap('<div class="scrollx"><table class="box"><thead><tr><th>Slot</th><th>Player</th>' +
      '<th class="hide-xs">Opp</th><th class="hide-sm">Status</th><th>Proj</th><th>Fpts</th></tr></thead><tbody>' +
      body + '</tbody></table></div>');
  }

  function vGame(id) {
    var g = GAMES.filter(function (q) { return q.id === id; })[0];
    if (!g) { view.innerHTML = '<p class="empty">Matchup not found.</p>'; return; }
    var wk = weekOf(g.week);
    var homeIsF = g.home === 'fowler';
    var L = homeIsF ? { id: g.fowler, lg: 'fowler', s: g.fowler_score } : { id: g.kyle, lg: 'kyle', s: g.kyle_score };
    var R = homeIsF ? { id: g.kyle, lg: 'kyle', s: g.kyle_score } : { id: g.fowler, lg: 'fowler', s: g.fowler_score };
    var done = played(g);

    function head(o, right) {
      var t = TEAM[o.id], st = teamStats(o.id);
      return '<div class="bsTeam' + (right ? ' right' : '') + '">' +
        '<a class="nm" href="#/team/' + t.id + '">' + esc(t.name) + '</a>' +
        '<p class="nowk">' + rec(st) + ' &middot; ' + esc(t.manager) + '</p>' +
        '<span class="pill ' + (o.lg === 'fowler' ? 'f' : 'k') + '">' +
        esc(DATA.leagues[o.lg].short) + '</span></div>';
    }

    var lw = '', rw = '';
    if (done) {
      if (L.s > R.s) { lw = 'win'; rw = 'lose'; }
      else if (R.s > L.s) { rw = 'win'; lw = 'lose'; }
    }

    function metaLine(o) {
      var box = boxFor(o.id, g.week);
      if (!box) return '<div class="bsMetaSide"><span class="dim">Not synced</span></div>';
      var m = boxMeta(g.week, box);
      return '<div class="bsMetaSide">' +
        '<span>Playing <b>' + m.playing + '</b></span>' +
        '<span>Yet to play <b>' + m.yet + '</b></span>' +
        '<span>Proj <b>' + num(m.proj) + '</b></span>' +
        '<span>Mins left <b>' + m.mins + '</b></span></div>';
    }

    view.innerHTML = '<a class="back" href="#/schedule/' + g.week + '">&larr; Week ' + g.week + ' &middot; ' + esc(wk.label) + '</a>' +
      '<div class="card bsHead">' +
      head(L, false) +
      '<div class="bsScore"><span class="s ' + lw + '">' +
      (typeof L.s === 'number' ? fp(L.s) : '—') + '</span>' +
      '<span class="dash">–</span>' +
      '<span class="s ' + rw + '">' +
      (typeof R.s === 'number' ? fp(R.s) : '—') + '</span>' +
      '<span class="wklbl">Week ' + g.week + (g.rematch ? ' &middot; rematch' : '') + '</span></div>' +
      head(R, true) +
      '</div>' +
      '<div class="bsMeta">' + metaLine(L) + metaLine(R) + '</div>' +
      '<div class="grid2">' + rosterTable(L.id, g.week, L.s) + rosterTable(R.id, g.week, R.s) + '</div>' +
      (BOX && BOX.updated ? '<p class="synced">' + syncNote() + '</p>' : '');
  }

  /* Most recent week this team has ESPN data for. */
  function lineupCard(id) {
    if (!BOX) return '';
    var weeks = Object.keys((BOX.weeks || {})).map(Number).sort(function (a, b) { return b - a; });
    var week = null;
    for (var i = 0; i < weeks.length; i++) { if (boxFor(id, weeks[i])) { week = weeks[i]; break; } }
    if (week === null) return '';
    var g = teamGames(id).filter(function (q) { return q.week === week; })[0];
    return '<div class="card" style="margin-bottom:18px">' +
      '<div class="pad bsCap" style="display:flex;justify-content:space-between;align-items:center;gap:10px">' +
      '<span>Week ' + week + ' lineup</span>' +
      (g ? '<a class="boxhint" href="#/game/' + g.id + '">Full matchup &rsaquo;</a>' : '') + '</div>' +
      rosterTable(id, week, null, true) +
      '</div>';
  }

  function wireGo() {
    view.querySelectorAll('[data-go]').forEach(function (n) {
      n.addEventListener('click', function (e) {
        if (e.target.tagName === 'A' || e.target.tagName === 'INPUT') return;
        location.hash = n.dataset.go;
      });
    });
  }

  /* ---------- export ---------- */

  function exportData() {
    var out = JSON.parse(JSON.stringify(window.GHOST_DATA));
    ['fowler', 'kyle'].forEach(function (lg) {
      out.leagues[lg].teams.forEach(function (o) {
        o.name = TEAM[o.id].name; o.manager = TEAM[o.id].manager;
      });
    });
    out.weeks.forEach(function (w) {
      w.games.forEach(function (g) {
        var live = GAMES.filter(function (q) { return q.id === g.id; })[0];
        g.fowler_score = live.fowler_score; g.kyle_score = live.kyle_score;
      });
    });
    var body = '// Ghost League data. Edit scores in the site UI and use Export to regenerate this file.\n' +
      'window.GHOST_DATA = ' + JSON.stringify(out, null, 2) + ';\n';
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([body], { type: 'text/javascript' }));
    a.download = 'schedule.js';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
  }

  /* ---------- router ---------- */

  function route() {
    var h = (location.hash || '#/scoreboard').replace(/^#\//, '').split('/');
    var tab = h[0];
    if (tab === 'scoreboard') vScoreboard();
    else if (tab === 'schedule') vSchedule(h[1] ? +h[1] : null);
    else if (tab === 'standings') vStandings();
    else if (tab === 'league') vLeague(h[1] === 'kyle' ? 'kyle' : 'fowler');
    else if (tab === 'team') vTeam(h[1]);
    else if (tab === 'game') vGame(h[1]);
    else vScoreboard();

    var act = tab === 'league' ? h[1]
      : tab === 'team' ? (TEAM[h[1]] && TEAM[h[1]].league)
      : tab === 'game' ? 'schedule'
      : tab;
    document.querySelectorAll('#tabs a').forEach(function (a) {
      a.classList.toggle('active', a.dataset.tab === act);
    });
    window.scrollTo(0, 0);
    noteStore();
  }

  index();
  loadLocal();
  window.addEventListener('hashchange', route);
  route();
})();
