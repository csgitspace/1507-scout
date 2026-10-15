# Milestone 4 — Event intel: TBA results, Statbotics, Next match, Data health

## Status: built and tested locally (2026-10-15), for a test drive at Rah Cha Cha Ruckus (Sat 2026-10-17)

- `npm test`: 67 pass (15 new in `tests/intel.test.js`).
- The station runs with the new panel. With no TBA key and Statbotics down,
  it shows clear messages and doesn't crash.
- All three dashboard screens render at phone width with real Code.js
  output.
- **Not yet done:** `dashboard:push` (it needs `data/dashboard.json` on this
  laptop), and a live run against TBA and Statbotics. On 2026-10-15 every
  Statbotics v3 data query returned HTTP 500.

## What

1. **TBA results, fetched automatically.** On each sync cycle (every 3 min)
   the scan station fetches the event's match results, rankings and OPRs
   from The Blue Alliance over the tethered phone.
2. **Statbotics EPA.** The station fetches each team's EPA from Statbotics:
   event EPA when Statbotics tracks the event, otherwise the team's 2026
   season EPA. It refreshes every 30 minutes.
3. **Next match** dashboard screen: a summary of the six teams in our next
   match (or any match picked from the list). It shows scouted stats, EPA,
   OPR, rank, mentor tags and notes, scout notes, and each alliance's
   summed EPA.
4. **Data health** dashboard screen: which scans are missing, team
   mismatches, matches with two or more scouts, records for matches not in
   the schedule, app versions, records per scout, records still waiting on
   the laptop, and when the data was last synced or fetched.

## Why

- A one-day offseason event gives each team about 8–10 quals. That's too
  few scouted matches for the pick list to rely on alone. EPA (from
  Statbotics) and OPR (from TBA) add data from the whole season.
- Mentors asked for Next match and Data health in `docs/dashboard.md`
  ("Other screens").
- With TBA results, coverage knows which matches have actually been
  played. So a match nobody scanned still shows up as missing, instead of
  being hidden because "played through" defaulted to the latest scan.

## Rules kept

- Outside data is **reference data**, never scouting data. It lives in its
  own settings keys on the laptop and its own tabs on the Sheet
  (`External`, `Results`). It never goes into `records`/`Raw`, and the
  summary math doesn't mix it into scouted averages.
- Every outside fetch is optional. If TBA or Statbotics is down, slow, or
  doesn't know the event, scanning and sync carry on, and the station
  shows why the fetch failed. The last good data is kept.
- Mentor tabs are still never touched by the sync.

## How

### Laptop
- `laptop/intel.js`:
  - `fetchTbaIntel` gets matches, rankings and OPRs; each one can fail on
    its own.
  - `fetchStatbotics` calls `/v3/team_events?event=` and falls back to
    `/v3/team_year/{team}/{year}` per team, 6 at a time, with timeouts.
  - `createIntel({ store })` runs them on a schedule and stores the results
    in `settings` (`intel:<event>`). It also reports status for the
    station UI.
  - Field names come from Statbotics' source (`backend/src/breakdown.py`,
    `team_event.py`): `epa.total_points` (a number) and
    `epa.breakdown.{auto_points, teleop_points, endgame_points, total_fuel,
    total_tower}`.
- `sync.js` sends `intel` when it has changed since the last confirmed
  sync. It sends `health` (the laptop's own coverage plus records waiting)
  on every sync.
- Coverage: when the schedule has a later match with a TBA result than the
  latest scan, the automatic "played through" uses that match.
- Station: a new **Event data** panel (TBA and Statbotics status, plus
  **Refresh now**), and a status line on the Scan tab.

### Dashboard
- Sync endpoint: writes `External` (one row per team) and `Results` (one
  row per match), and stores `health` in `Config`.
- Pick list:
  - Teams from the TBA team list appear even before they're scouted, so
    EPA is there from match 1.
  - Each card shows EPA, OPR and rank.
  - A **Sort** menu: pick order, EPA, or scouted fuel. Reordering only
    works under "pick order".
- New tabs in the header: **Pick list · Next match · Data health**.

## How it'll be tested
- `npm test`:
  - TBA and Statbotics parsing, using response shapes copied from their
    source
  - falling back from event EPA to season EPA
  - a fetch failure keeps the last good data
  - sync sends intel only when it changes
  - the endpoint writes `External` and `Results`
  - the pick list includes unscouted teams with EPA
  - Next match picks our first unplayed match
  - the Data health payload
  - coverage uses TBA results
- By hand: a station practice run with a practice schedule, then push the
  dashboard and open all three screens on a phone.

## Before Saturday (needs Chris)
- **Event code:** look up the Ruckus TBA key on thebluealliance.com.
- On this laptop:
  - copy `data/dashboard.json` (and `data/google-oauth-client.json`) from
    the laptop that ran `dashboard:create`
  - `npm.cmd run station:login`
  - `npm.cmd run dashboard:push`
  - enter the TBA read key
