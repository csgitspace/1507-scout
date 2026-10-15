# Milestone 6 — Faster pick list, Analyze charts, alliance-selection help

## Status: built and deployed (2026-10-15), for Rah Cha Cha Ruckus (Sat 2026-10-17)

- `npm test`: 77 pass (4 new).
- Browser check at 390 px: pick list with picked teams and Best available,
  the saved copy shown before the server answers, and every Analyze chart.
  No horizontal overflow.
  - Headless Chrome won't open a window narrower than 500 px, so the page
    is checked inside a 390 px iframe.
- Charts that need per-match data fill in after the first sync from the
  scan station following this deploy.

## What

1. **Faster loading**
   - The phone keeps the last pick list it loaded and shows it right away,
     then refreshes in the background ("Showing your saved copy — updating…").
     The saved copy is per Google account (the page knows who's signed in),
     so private notes never show to the next person on a shared device.
   - Fewer Sheets calls per load. Each tab is read with one call instead of
     three or four, and reading the pick list never creates or reformats a
     tab. Before: about 40 calls per load. After: about 10.
2. **Analyze screen** (new tab in the header), charts drawn with Chart.js:
   - **Scoring vs reliability**: every team as a dot (fuel per match vs
     reliability), colored by the official tag. The top-right corner is
     the pick list.
   - **Consistency**: each team's lowest–highest fuel per match, with its
     average. A short bar is a team you can count on.
   - **Our scouting vs EPA**: a dot far from the trend means our scouts and
     Statbotics disagree, or the robot changed. Worth a second look.
   - **Auto vs teleop** and **Climbing** (L3 / L2 / L1 / none): stacked bars
     for the top teams.
   - **Compare & alliance builder**: pick up to 3 teams. Side-by-side stats,
     fuel per match over time for each, and what they'd add up to with us.
3. **Alliance selection**: pick leads mark a team **Picked** when another
   alliance takes it. Picked teams are dimmed for everyone, a "Best
   available" line shows the top three still on the board, and a filter
   can hide picked teams. Picking never changes the pick order.

## Why

- Mentors open the pick list on phones over cellular. Every second matters
  at 4pm Saturday, and the old load path read every tab several times.
- With 8–10 quals, averages hide a lot: a 30-fuel average can be steady 30s
  or 0s and 60s. The charts show spread, outliers and data-quality
  problems at a glance.
- During alliance selection the question is "who's the best team still
  available?", and that changes every 30 seconds.

## How

- **Per-match data**: the sync endpoint adds a `series_json` column to the
  Summary tab (per match: auto fuel, teleop fuel, climb level, no-show,
  broke). The column is appended at the end, so existing columns don't
  move. The dashboard never reads Raw. Charts that need it show "comes
  with the next sync" until the next sync after this update.
- `readObjects_` reads a tab with one `getDataRange().getValues()`.
  `kvGetAll_` no longer creates the Config tab. The pick list reads tabs
  with `getSheetByName` and doesn't call `ensureHeaderColumns_`.
- Chart.js 4 loads from cdnjs **only when Analyze is opened**, so the pick
  list doesn't wait for it.
- **Picked** is a new `picked` column on the Mentor tab (the official
  layer), saved by `savePicked`, pick leads only. "Clear all picked" is
  for leads, for the next event.
- `getPickList` also returns our own team's summary (`us`) for the
  alliance builder. We're still left off the list itself.

## Tested by

- `npm test`:
  - the series in the summary
  - one-call reads
  - the pick list doesn't create tabs
  - `us` and `picked` come back from `getPickList`
  - `savePicked` is for pick leads only, and the sync never clears it
- Browser check at phone width (390 px): the real `Index.html`, fed by the
  real `Code.js` output from the fake Sheet with a sample event, in
  headless Chrome. Pick list (with saved copy and picked teams) and every
  Analyze chart, screenshotted and checked by eye.

## Not in this milestone

- A server-side cache (CacheService) for the shared data. Worth doing if
  the pick list is still slow after this.
- Per-match trend lines at a one-day event are thin (8–10 points). Useful
  later at districts.
