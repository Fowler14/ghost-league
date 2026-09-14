#!/usr/bin/env node
/* Pull weekly box scores (every player, every team) from ESPN and write data/boxscores.js.
 *
 *   node tools/fetch-espn.mjs              # weeks 1..current
 *   node tools/fetch-espn.mjs --week 3     # just week 3
 *   node tools/fetch-espn.mjs --all        # all 14 ghost weeks
 *
 * Credentials come from env vars first (so GitHub Actions can supply secrets),
 * then from tools/espn-config.json (gitignored — never commit it).
 *
 *   ESPN_SEASON            e.g. 2026
 *   FOWLER_LEAGUE_ID  ESPN_S2_FOWLER  SWID_FOWLER
 *   KYLE_LEAGUE_ID    ESPN_S2_KYLE    SWID_KYLE
 *
 * A league whose credentials are missing or rejected is reported and skipped —
 * the other league still syncs, and the site degrades to "not connected" for it.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LEAGUE_KEYS = ['fowler', 'kyle'];

/* ---------- ESPN id maps ---------- */

const POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 9: 'DT', 10: 'DE', 11: 'LB', 12: 'CB', 13: 'S', 16: 'DST' };
const SLOT = {
  0: 'QB', 1: 'QB', 2: 'RB', 3: 'RB/WR', 4: 'WR', 5: 'WR/TE', 6: 'TE', 7: 'OP',
  16: 'D/ST', 17: 'K', 18: 'P', 19: 'HC', 20: 'BE', 21: 'IR', 23: 'FLEX', 24: 'ER'
};
const NFL = {
  0: 'FA', 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB',
  10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO',
  19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB',
  28: 'WSH', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
};
const INJ = { ACTIVE: '', NORMAL: '', QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'O', INJURY_RESERVE: 'IR', SUSPENSION: 'SUSP', PROBABLE: 'P' };
const SLOT_ORDER = { QB: 1, RB: 2, 'RB/WR': 3, WR: 4, 'WR/TE': 5, TE: 6, OP: 7, FLEX: 8, 'D/ST': 9, K: 10, BE: 11, IR: 12 };

/* ---------- config ---------- */

function loadConfig() {
  let file = {};
  const path = join(ROOT, 'tools', 'espn-config.json');
  if (existsSync(path)) {
    try { file = JSON.parse(readFileSync(path, 'utf8')); }
    catch (e) { die(`tools/espn-config.json is not valid JSON — ${e.message}`); }
  }
  const fileLeagues = file.leagues || {};
  const env = (name) => (process.env[name] || '').trim();
  const cfg = {
    season: Number(env('ESPN_SEASON') || file.season || new Date().getFullYear()),
    leagues: {}
  };
  for (const key of LEAGUE_KEYS) {
    const f = fileLeagues[key] || {};
    const up = key.toUpperCase();
    cfg.leagues[key] = {
      leagueId: env(`${up}_LEAGUE_ID`) || String(f.leagueId || '').trim(),
      espn_s2: env(`ESPN_S2_${up}`) || String(f.espn_s2 || '').trim(),
      SWID: env(`SWID_${up}`) || String(f.SWID || '').trim(),
      teamMap: f.teamMap || {}
    };
  }
  return cfg;
}

function die(msg) { console.error(`\n${msg}\n`); process.exit(1); }

/* Cookie values get mangled in transit — pasted through a chat app, copied from a viewer
   that shows them URL-decoded, or truncated. Catch that here with a clear message rather
   than letting fetch() throw "Cannot convert argument to a ByteString". */
function credentialProblem(league) {
  const s2 = league.espn_s2 || '';
  const swid = league.SWID || '';
  if (!s2 || !swid) return null;                       // absent is handled elsewhere
  // eslint-disable-next-line no-control-regex
  if (/[^\x00-\xFF]/.test(s2) || /[^\x00-\xFF]/.test(swid)) {
    const ch = [...s2].find((c) => c.charCodeAt(0) > 255);
    return `espn_s2 contains a non-Latin-1 character (U+${ch.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')})` +
           ` — the value was altered in transit and cannot be sent as a cookie. Re-copy it.`;
  }
  const stripped = s2.replace(/%[0-9A-Fa-f]{2}/g, '');
  const odd = [...new Set([...stripped].filter((c) => !/[A-Za-z0-9]/.test(c)))];
  if (odd.length) {
    return `espn_s2 contains characters that never appear in a valid token (${odd.map((c) => JSON.stringify(c)).join(', ')})` +
           ` — it looks URL-decoded or corrupted. Copy the raw value from Chrome DevTools >` +
           ` Application > Cookies, not from a cookie viewer that decodes it.`;
  }
  if (!/^\{[0-9A-Fa-f-]{36}\}$/.test(swid)) {
    return `SWID should look like {XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX} including the braces.`;
  }
  return null;
}

/* ---------- fetch helpers ---------- */

async function getJSON(url, headers) {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 ghost-league-sync', ...headers } });
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function pullWeek(league, season, week) {
  const url = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/${season}` +
    `/segments/0/leagues/${league.leagueId}?view=mMatchup&view=mMatchupScore&view=mTeam` +
    `&scoringPeriodId=${week}`;
  const headers = {};
  if (league.espn_s2 && league.SWID) {
    const swid = league.SWID.startsWith('{') ? league.SWID : `{${league.SWID}}`;
    headers.cookie = `espn_s2=${league.espn_s2}; SWID=${swid}`;
  }
  return getJSON(url, headers);
}

/* ---------- normalising ---------- */

function statFor(player, week, sourceId) {
  const stats = player.stats || [];
  for (const s of stats) {
    if (s.scoringPeriodId === week && s.statSourceId === sourceId && (s.statSplitTypeId === 1 || s.statSplitTypeId === undefined)) {
      return typeof s.appliedTotal === 'number' ? round2(s.appliedTotal) : null;
    }
  }
  for (const s of stats) {
    if (s.scoringPeriodId === week && s.statSourceId === sourceId) {
      return typeof s.appliedTotal === 'number' ? round2(s.appliedTotal) : null;
    }
  }
  return null;
}

function round2(n) { return Math.round(n * 100) / 100; }

function rosterOf(side, week) {
  const roster = side.rosterForCurrentScoringPeriod || side.rosterForMatchupPeriod || {};
  const entries = roster.entries || [];
  return entries.map((e) => {
    const pool = e.playerPoolEntry || {};
    const p = pool.player || e.player || {};
    const slot = SLOT[e.lineupSlotId] ?? String(e.lineupSlotId);
    const actual = statFor(p, week, 0);
    return {
      name: p.fullName || 'Unknown',
      pos: POS[p.defaultPositionId] || '',
      nfl: NFL[p.proTeamId] ?? '',
      slot,
      starter: e.lineupSlotId !== 20 && e.lineupSlotId !== 21,
      inj: INJ[p.injuryStatus] ?? '',
      proj: statFor(p, week, 1),
      fpts: actual === null && typeof pool.appliedStatTotal === 'number' ? round2(pool.appliedStatTotal) : actual
    };
  }).sort((a, b) =>
    (SLOT_ORDER[a.slot] || 99) - (SLOT_ORDER[b.slot] || 99) ||
    a.name.localeCompare(b.name));
}

/* Every team's roster for one scoring period, keyed by ESPN team id. */
function teamsFromSchedule(raw, week) {
  const out = {};
  for (const m of raw.schedule || []) {
    for (const key of ['home', 'away']) {
      const side = m[key];
      if (!side || side.teamId === undefined) continue;
      const players = rosterOf(side, week);
      if (!players.length) continue;
      // A team can appear in several matchup periods; keep the one with real players.
      if (!out[side.teamId] || players.length > out[side.teamId].length) out[side.teamId] = players;
    }
  }
  return out;
}

function espnTeamMeta(raw) {
  const members = {};
  for (const m of raw.members || []) {
    members[m.id] = `${m.firstName || ''} ${m.lastName || ''}`.trim() || m.displayName || '';
  }
  return (raw.teams || []).map((t) => ({
    id: t.id,
    abbrev: t.abbrev || '',
    name: (t.name || `${t.location || ''} ${t.nickname || ''}`).trim(),
    owners: (t.owners || []).map((o) => members[o]).filter(Boolean)
  }));
}

/* Match ESPN teams to the site's F1..F10 / K1..K10 ids: explicit map, then abbrev, then name. */
function mapTeams(espnTeams, siteTeams, overrides, label) {
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const byId = {};
  const pool = [...espnTeams];
  const take = (espnId) => {
    const i = pool.findIndex((p) => p.id === espnId);
    return i >= 0 ? pool.splice(i, 1)[0] : null;
  };

  for (const [siteId, espnId] of Object.entries(overrides || {})) {
    const hit = take(Number(espnId));
    if (hit) byId[siteId] = hit;
    else console.warn(`  ! ${label}: teamMap says ${siteId} -> ESPN id ${espnId}, but no such team`);
  }

  const unmatched = [];
  for (const st of siteTeams) {
    if (byId[st.id]) continue;
    let i = pool.findIndex((e) => norm(e.abbrev) && norm(e.abbrev) === norm(st.abbrev));
    // Managers rename their teams constantly; the person behind the team is the stable id.
    if (i < 0) i = pool.findIndex((e) => (e.owners || []).some((ow) => norm(ow) && norm(ow) === norm(st.manager)));
    if (i < 0) i = pool.findIndex((e) => norm(e.name) === norm(st.name));
    if (i < 0) {
      // Site names from the screenshots are truncated ("Lemme Burrow a D…") — prefix match.
      const stem = norm(st.name).slice(0, 8);
      if (stem.length >= 5) i = pool.findIndex((e) => norm(e.name).startsWith(stem));
    }
    if (i >= 0) byId[st.id] = pool.splice(i, 1)[0];
    else unmatched.push(st);
  }

  if (unmatched.length) {
    console.warn(`  ! ${label}: ${unmatched.length} site team(s) unmatched:`);
    unmatched.forEach((t) => console.warn(`      "${t.name}" (${t.abbrev})`));
    console.warn(`    ESPN teams left over: ${pool.map((p) => `[${p.id}] "${p.name}" (${p.abbrev}) owner ${(p.owners || []).join('/') || '?'}`).join(', ') || 'none'}`);
    console.warn(`    Fix by adding a teamMap entry in tools/espn-config.json, e.g. {"F3": ${pool[0] ? pool[0].id : 7}}`);
  }
  return byId;
}

/* ---------- public NFL schedule (no auth needed) ---------- */

function minutesLeft(status) {
  const t = status.type || {};
  if (t.state === 'pre') return 60;
  if (t.state === 'post') return 0;
  const period = status.period || 1;
  const clock = status.displayClock || '0:00';
  const [m, s] = clock.split(':').map(Number);
  const inQuarter = (m || 0) + (s || 0) / 60;
  const quartersLeft = Math.max(0, 4 - period);
  return round2(inQuarter + quartersLeft * 15);
}

async function pullNflWeek(season, week) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=${week}&seasontype=2&dates=${season}`;
  const raw = await getJSON(url);
  return (raw.events || []).map((ev) => {
    const c = (ev.competitions || [])[0] || {};
    const comps = c.competitors || [];
    const home = comps.find((x) => x.homeAway === 'home') || {};
    const away = comps.find((x) => x.homeAway === 'away') || {};
    const st = ev.status || {};
    return {
      home: (home.team || {}).abbreviation || '',
      away: (away.team || {}).abbreviation || '',
      homeScore: Number(home.score || 0),
      awayScore: Number(away.score || 0),
      state: ((st.type || {}).state) || 'pre',
      detail: ((st.type || {}).shortDetail) || '',
      period: st.period || 0,
      clock: st.displayClock || '',
      minsLeft: minutesLeft(st)
    };
  });
}

/* ---------- main ---------- */

const args = process.argv.slice(2);
const cfg = loadConfig();
const site = JSON.parse(readFileSync(join(ROOT, 'data', 'schedule.json'), 'utf8'));

function currentGhostWeek() {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  for (const w of site.weeks) {
    if (today <= new Date(`${w.end}T23:59:59`)) return w.week;
  }
  return site.weeks.length;
}

let weeks;
const wIdx = args.indexOf('--week');
if (wIdx >= 0 && args[wIdx + 1]) weeks = [Number(args[wIdx + 1])];
else if (args.includes('--all')) weeks = site.weeks.map((w) => w.week);
else weeks = site.weeks.map((w) => w.week).filter((w) => w <= currentGhostWeek());

console.log(`Season ${cfg.season} · weeks ${weeks[0]}–${weeks[weeks.length - 1]}`);

/* NFL games first — public, and the site needs them even with zero league access. */
const nfl = {};
for (const w of weeks) {
  try {
    nfl[w] = await pullNflWeek(cfg.season, w);
    console.log(`- NFL week ${w}: ${nfl[w].length} games`);
  } catch (e) {
    nfl[w] = [];
    console.warn(`- NFL week ${w}: FAILED (${e.message})`);
  }
}

const leagueInfo = {};
const byWeek = {};
weeks.forEach((w) => { byWeek[w] = { teams: {} }; });

for (const key of LEAGUE_KEYS) {
  const lc = cfg.leagues[key];
  const info = { leagueId: lc.leagueId, connected: false, error: null, names: {}, abbrevs: {} };
  leagueInfo[key] = info;

  if (!lc.leagueId) { info.error = 'no leagueId configured'; console.log(`- ${key}: skipped (${info.error})`); continue; }

  /* No credentials is not automatically fatal: a league whose commissioner has made it
     viewable to the public answers fine without any cookie. Try, and only complain if
     ESPN actually refuses. */
  const anonymous = !lc.espn_s2 || !lc.SWID;

  const credErr = credentialProblem(lc);
  if (credErr) {
    info.error = credErr;
    console.error(`- ${key}: bad credentials — ${credErr}`);
    continue;
  }

  let map = null;
  let players = 0;

  for (const w of weeks) {
    let raw;
    try {
      raw = await pullWeek(lc, cfg.season, w);
    } catch (e) {
      const hint = e.status === 401
        ? (anonymous
            ? ' — this league is private and no credentials are configured. Either add espn_s2 + SWID from a member, or ask the commissioner to make the league viewable to the public (then no credentials are needed).'
            : ' — credentials rejected, or this account is not a member of that league')
        : e.status === 404 ? ' — check leagueId and season'
        : '';
      info.error = `${e.message}${hint}`;
      console.error(`- ${key}: FAILED on week ${w} — ${info.error}`);
      break;
    }

    if (!map) {
      const meta = espnTeamMeta(raw);
      map = mapTeams(meta, site.leagues[key].teams, lc.teamMap, key);
      for (const [siteId, t] of Object.entries(map)) {
        info.names[siteId] = t.name;
        info.abbrevs[siteId] = t.abbrev;
      }
      info.connected = true;
    }

    const rosters = teamsFromSchedule(raw, w);
    for (const [siteId, t] of Object.entries(map)) {
      const list = rosters[t.id];
      if (!list || !list.length) continue;
      const starters = list.filter((p) => p.starter);
      const bench = list.filter((p) => !p.starter);
      const sum = (arr, f) => round2(arr.reduce((n, p) => n + (p[f] || 0), 0));
      byWeek[w].teams[siteId] = {
        total: sum(starters, 'fpts'),
        proj: sum(starters, 'proj'),
        benchTotal: sum(bench, 'fpts'),
        benchProj: sum(bench, 'proj'),
        players: list
      };
      players += list.length;
    }
    process.stdout.write(`- ${key}: week ${w} ok\r`);
  }

  if (info.connected) {
    console.log(`- ${key}: connected · ${Object.keys(map).length}/10 teams matched · ${players} player-weeks`);
  }
}

const out = {
  updated: new Date().toISOString(),
  season: cfg.season,
  leagues: leagueInfo,
  nfl,
  weeks: byWeek
};

const body = '// Generated by tools/fetch-espn.mjs — do not hand-edit.\n' +
  `window.GHOST_BOX = ${JSON.stringify(out)};\n`;

/* Only rewrite when something other than the timestamp moved — otherwise a scheduled
   run would produce a commit every time it fires, even on a quiet Tuesday. */
const outPath = join(ROOT, 'data', 'boxscores.js');
const fingerprint = (text) => {
  const i = text.indexOf('{');
  const j = text.lastIndexOf('}');
  if (i < 0 || j < 0) return null;
  try {
    const parsed = JSON.parse(text.slice(i, j + 1));
    delete parsed.updated;
    return JSON.stringify(parsed);
  } catch { return null; }
};
const previous = existsSync(outPath) ? fingerprint(readFileSync(outPath, 'utf8')) : null;
const changed = previous === null || previous !== fingerprint(body);
if (changed) writeFileSync(outPath, body);
else console.log('\nNo change since the last sync — data/boxscores.js left alone.');

const totalPlayers = Object.values(byWeek).reduce(
  (n, w) => n + Object.values(w.teams).reduce((m, t) => m + t.players.length, 0), 0);
if (changed) console.log(`\nWrote data/boxscores.js — ${totalPlayers} player rows, ${(body.length / 1024).toFixed(0)} KB`);
const live = LEAGUE_KEYS.filter((k) => leagueInfo[k].connected);
if (!live.length) {
  console.log('No league connected. The site will show NFL games but no rosters.');
  process.exitCode = 2;
}
