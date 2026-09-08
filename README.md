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

## Updating scores each week

1. Open the **Schedule** tab and select the week.
2. Click **Enter scores** and type each team's fantasy points from your ESPN screenshots.
   The left input belongs to the left team, the right input to the right team.
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
js/app.js           routing, standings math, score editor, export
data/schedule.js    the data the site reads  <-- replace this on update
data/schedule.json  same data as plain JSON, for reference
```
