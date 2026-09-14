# Ghost League

Static site for the 14-week cross-league ghost matchup between **Fowler's League** and **Kyle's League**.
No build step, no dependencies, no backend — plain HTML/CSS/JS.

## Run it locally

```bash
python3 -m http.server 8777
```

Then open <http://localhost:8777>. (Opening `index.html` by double-click also works, since the data
loads from `data/schedule.js` rather than `fetch()`.)

## Deploying

Upload the whole folder to any static host — GitHub Pages, Netlify, Cloudflare Pages, S3. Nothing to configure.

## Player scores from ESPN

Both leagues are **private**, so ESPN will not serve their rosters to an anonymous request
(it answers `401 You are not authorized to view this League`). A static page also cannot send
login cookies to espn.com. So the data is pulled by a script and committed:

```bash
node tools/fetch-espn.mjs            # weeks 1..current
node tools/fetch-espn.mjs --week 3   # one week
node tools/fetch-espn.mjs --all      # all 14
```

It writes `data/boxscores.js`, which the site reads for rosters, per-player points, projections
and NFL game status. Commit that file to publish the update.

### One-time setup

1. Copy `tools/espn-config.example.json` to `tools/espn-config.json` (already gitignored).
2. Log in at fantasy.espn.com in Chrome. DevTools > Application > Cookies >
   `https://fantasy.espn.com`. Copy `espn_s2` and `SWID` (keep the braces on SWID).
3. Paste them into the `fowler` block.

**Your account is only a member of your own league**, so those cookies unlock Fowler's League
only. Kyle's League needs credentials from someone in it — either Kyle pastes his own
`espn_s2`/`SWID` into the `kyle` block, or he adds you to his league and you re-copy yours.
Until then the script reports Kyle's League as not connected, the Fowler side still syncs, and
the site says so instead of breaking.

These cookies are live ESPN session credentials. They belong in the gitignored config or in
GitHub Actions secrets — never in a commit.

### Automatic refresh

`.github/workflows/sync-espn.yml` re-runs the sync every 20 minutes during game windows
(Sun afternoon/night, MNF, TNF) plus a daily catch-up, and commits only when a number actually
changed. It needs these repository secrets — Settings > Secrets and variables > Actions:

| Secret | Value |
| --- | --- |
| `ESPN_S2_FOWLER` | your `espn_s2` |
| `SWID_FOWLER` | your `SWID` |
| `ESPN_S2_KYLE` | Kyle's `espn_s2` (once you have it) |
| `SWID_KYLE` | Kyle's `SWID` |

Without any secrets the workflow skips cleanly rather than failing. ESPN cookies expire
every so often; when the sync starts reporting `401`, re-copy them.

### What you get

Click any matchup on the Scoreboard or Schedule to open a side-by-side box score: both starting
lineups with slot, NFL team, opponent, game result, projection and fantasy points, plus bench
blocks, totals, and the live "yet to play / proj / mins left" line. Team pages show that week's
lineup too.

Weekly matchup totals fill in from ESPN automatically once a team's starters have kicked off.
ESPN's full team names also replace the ones the screenshots truncated.

## Updating scores by hand

Hand-entered scores still beat ESPN, so you can correct anything the sync gets wrong.

1. Open the **Schedule** tab and select the week.
2. Click **Enter scores**. The boxes are pre-filled with ESPN's numbers; type over one to
   override it. Clear **both** boxes for a matchup to hand it back to ESPN.
   Entries save to your browser immediately.
3. Click **Export data file**. It downloads `schedule.js`.
4. Replace `data/schedule.js` with the downloaded file, then commit/redeploy.

Step 4 is what makes the scores permanent and visible to everyone else. Until you do it,
the scores live only in your own browser.

### Fixing team names

Three names were cut off in the source screenshots (`Lemme Burrow a D…`, `Step Burrow I'm St…`,
`Kyle's Top-Notch…`). On either league tab, click **Edit team names** to correct them, then
export as above.

## Format

- Every matchup is cross-league. No team ever plays inside its own league.
- **Weeks 1–10:** full round robin — each team faces all 10 opponents from the other league once.
- **Weeks 11–14:** rematches of weeks 1–4, the longest possible gap before a repeat.
- **Scoring:** outright higher score = 1 League Point. A tie splits it (0.5 each). Maximum 14.
- **One title.** All 20 teams compete on a single Ghost League leaderboard — the most League Points
  across both leagues wins it. Ties broken by total fantasy points scored.
- The Standings tab defaults to that combined leaderboard; a **By league** toggle splits it into the
  two 10-team tables if you want to see how you rank against your own leaguemates.
- Home/away is display order only and has no scoring effect; every team is home 7 times.

## Files

```
index.html          markup and tab nav
css/styles.css      all styling
js/app.js           routing, standings math, box scores, score editor, export
data/schedule.js    the data the site reads  <-- replace this on update
data/schedule.json  same data as plain JSON, for reference
data/boxscores.js   ESPN rosters + player points  <-- generated, commit it
tools/fetch-espn.mjs        the sync script
tools/espn-config.json      your ESPN cookies (gitignored, never commit)
.github/workflows/sync-espn.yml   scheduled refresh
```
