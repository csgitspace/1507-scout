# Milestone 8 — match13 ratings, forecasts, and a Lookup team screen

## Status: built and deployed (2026-10-15), for Rah Cha Cha Ruckus (Sat 2026-10-17, TBA key `2026nyrr`)

- `npm test`: 94 pass (5 new in `tests/match13.test.js`).
- **Live check** with the real key:
  - match13 has all 25 teams at 2026nyrr. 1507 is xP 153.9 ±32, 3rd
    going in.
  - The season list is 3,726 teams in ~2 s, about 400 KB, sent only
    when it changes.
  - Forecasts and projected ranks are empty until the schedule exists
    and the event is live.
- The key is saved in the station database (`data/`, gitignored).
- Browser check at phone width: the Lookup screen, Next match forecast,
  and the card's outside-data line. Five header buttons fit on one row.

## What

1. **match13 on the scan station** (like Statbotics, in `laptop/match13.js`),
   over the tethered phone:

   | Route | Every | Gives |
   |---|---|---|
   | `/v1/events/{event}/teams` | 10 min | each team's **xP** (match13's points-per-match rating) with auto / teleop / endgame, its spread (±), bonus-RP chances, and match13's copy of Statbotics EPA |
   | `/v1/events/{event}/matches` | 3 min (each sync) | each match's **forecast**: red win chance, predicted scores |
   | `/v1/events/{event}/sim` | 10 min | **projected final rank** per team (median, 5th–95th percentile); live events only |
   | `/v1/years/{year}/teams?scope=all` | 6 h | every team's season rating (all pages), for **Lookup** |

   About 33 requests an hour. Their allowance is 60/min, 1000/hour and
   30000/week per account.
2. **Key**: a "match13 API key" box on Event setup. Stored in the station
   database like the TBA key (or the `M13_KEY` environment variable), never
   in git or the dashboard.
3. **Dashboard**
   - **Cards / Next match / Compare:** "xP 153.9 (auto 25 · tele 130 ·
     end −1)" and "Proj. rank #3 (1–6)".
   - **Next match:** "match13: Red 64% · 148–131".
   - **EPA fallback:** when Statbotics has no EPA for a team, show
     match13's copy (labelled).
4. **Lookup screen** (5th button), any team number:
   - match13 season rating: xP and parts, ±, season rank and percentile,
     EPA, OPR
   - if the team is at our event: our scouting, best auto, trench,
     shooter, pit answers, official tag and shared note, event xP and
     projected rank
   - a link to the team's match13 page
   - recent lookups remembered on the phone

## Why

- A second outside rating, and a backup for Statbotics: it had errors on
  2026-10-15, and match13 returns EPA too.
- Match forecasts and projected final ranks are new. Projected ranks say
  who's likely to be an alliance captain, so who will still be available
  when we pick.
- Lookup answers "who is team 4481?" for any team, not only those at our
  event.

## How

- **Why the laptop fetches** (and the dashboard doesn't call match13
  itself): a fetch from the dashboard would need a new Google permission
  ("connect to an external service"), prompting every pick-team member
  again, and the key would be visible to Sheet editors. The laptop
  already fetches outside data and already has the key.
- **Season data travels separately from event intel** (it's big: about
  3,500 teams). It's sent only when its fingerprint changes, into a
  protected `Season` tab. Lookup reads that tab; the pick list never does.
- **Event data** goes into new columns at the end of `External`, plus a
  `Forecast` tab. Reference data only, never mixed into scouting.
- **Errors explained:**
  - 401: "key not accepted, make a new one"
  - 429: "rate limited, wait N s", taken from `Retry-After`
  - 404: no data yet. Normal before the event; the simulation runs only
    while the event is live.
- Their data is "All rights reserved". Test fixtures are made-up numbers
  in their published format, not copies of their data.

## Tested by

- `npm test`:
  - parsers with made-up fixtures in their documented format
  - Bearer header sent, 401 / 429 / 404 handling, season paging
  - `externalFor` adds xP / projected rank and the EPA fallback
  - the sync endpoint writes Forecast and Season, and Season only when it
    changes
  - dashboard Lookup and the Next match forecast
- Live check against `2026nyrr` with the real key (a handful of requests).
- Browser check at phone width: a card's outside-data line, Next match
  forecast, the Lookup screen.
