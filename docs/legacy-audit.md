# Legacy App Audit — v3 (Apps Script + Google Sheets)

Source: `legacy/Code.gs` and `legacy/index.html` (copy these into the repo's
`legacy/` folder; they are the previous iteration's "source of truth").

This audit maps what exists onto the new offline architecture so we reuse
what works and fix what doesn't. Treat the issues list as a to-do for the
new build, not as criticism of v3 — it was designed for a different
(always-online) world.

## What the legacy app is

- A single-page **Google Apps Script web app**: `Code.gs` (server) +
  `index.html` (UI served through `HtmlService`), with a **Google Sheet as
  the database**.
- Every action (load schedule, save a match, look up a team) is a
  `google.script.run` call, so **every device needs internet for every
  action**. There is no offline queue; a failed save keeps the form open
  but a page reload loses it.
- It is **not** Node/Express/SQLite. Earlier planning notes that assumed
  that stack were wrong for the legacy app (and the QR laptop app is a
  separate, new component).
- Six tabs: Match, Pit, Review, Compare, Alliance Board, Admin.

## Data model (Sheets)

| Sheet | Purpose | Key columns |
|---|---|---|
| `Config` | key/value settings | `event_key`, `last_sync` ("PRACTICE MODE" for practice) |
| `Teams` | event team list | team_number, team_name, city, state_prov, country |
| `Matches` | schedule | match_key, comp_level, match_number, red1-3, blue1-3 |
| `MatchData` | scouted matches | see field table below; `unique_key` = match_key + team |
| `PitData` | pit scouting | ~23 columns incl. `robot_photo_url`, `pit_notes` |
| `Scouts` | profiles | scout_id, scout_name, created_at, last_seen |
| `Favorites` | per-scout favorite teams | scout_id, team_number |
| `Assignments` | scout → match + team | scout_id, match_key, team_number, notes |

TBA key is stored in Script Properties (`TBA_KEY`) — keep that practice.

## Feature inventory and what happens to each

| Legacy feature | Where it lives | In the new architecture |
|---|---|---|
| Match scouting form (steppers for fuel +1/+5/+10, checkboxes, ratings) | Match tab, `submitMatchReport` | **Port to the offline iPad web app.** Save to IndexedDB, show a QR code instead of calling the server. Keep the big-tap stepper layout. |
| Pit scouting form | Pit tab, `submitPitReport` | **Port, but needs a transport decision** (see Decisions: pit data and photos). |
| Client-side match lookup ("event index") | `getEventIndex_` → `eventIndex` in the browser | **Keep the idea.** The iPad needs a schedule snapshot loaded while online. Fix the playoff key (Issue 1). |
| Scout profiles with typeahead | `registerOrLookupScout`, profile modal | **Replace** with a config QR scanned once per iPad (sets scout ID, event, station). Offline devices can't fetch a scout list, and it matches the admin-controlled rule. |
| Per-match scout assignments | `Assignments` sheet, `adminAssignMatchTeam` | **Simplify to station-based assignment** (e.g. "Scout 3 = Red 2 all event"), carried in the config QR. The iPad derives the team from schedule + station. See Decisions. |
| Review (team report) | `getBotSummary`, Review tab | **Move to the dashboard** and the laptop. Its stats feed the pick list. |
| Compare (two teams) | `getCompareData`, Compare tab | **Move to the dashboard.** |
| Alliance Board (favorites, consensus 2+/3+ highlighting) | `Favorites`, board functions | **Move to the dashboard** as a "scout favorites" signal on the pick list. Needs an input path (see Decisions). |
| TBA schedule/team sync | `adminInitialize` | **Laptop job** (every few minutes over the tether) plus a pre-event load. Remove from scout-facing screens. |
| Practice mode (20 dummy matches) | `adminPracticeMode` | **Keep.** Use it for the airplane-mode test and the mock event. |
| TBA team info and last-year awards | `fetchPitTeamInfo` | Pre-event fetch; cache results in the dashboard. |
| Update-or-append de-duplication | `safeUpdateOrAppend_` | **Keep the behavior**; decide the key (Issue 3). |
| Caching (event index, TBA lookups) | `CacheService` | Still useful on the dashboard side. |
| Robot photo (resize, upload to Drive) | `resizeImageToDataURL`, Drive upload | **Can't ride a QR.** Needs its own plan. |

## Issues found (fix or decide in the new build)

1. **Playoff schedule collision.** The event index is keyed
   `comp_level + match_number`. TBA keys playoff matches by *set* too (for
   example `sf3m1`), and the `Matches` sheet doesn't store `set_number`, so
   different playoff matches share a key and overwrite each other. Verify
   against a real event's data, and add `set_number` to the schedule model
   and the record key.
2. **Station is hardcoded to 1.** `submitMatch` always sends `station: 1`,
   so station data is meaningless today. Station-based assignment (above)
   fixes this and makes "which station-matches are missing?" answerable.
3. **De-duplication ignores the scout.** `unique_key` is match + team, so a
   second scout covering the same team in the same match silently
   overwrites the first. The new design should decide deliberately:
   include `scout_id` (keep both, flag duplicates) or exclude it (last
   write wins).
4. **Admin functions are open to every scout.** The Admin tab is visible to
   everyone, and `adminInitialize` (overwrites `Teams` and `Matches`),
   `adminPracticeMode` and the assignment functions are public Apps Script
   functions with no access check. This conflicts with the
   admin-controlled-setup rule. Admin actions should not exist on scout
   iPads at all; on the dashboard they need an allow-list.
5. **"Dead" is ambiguous.** The field is `auto_dead`, the checkbox says
   "Robot Died/No Show," and the Review tab reports it as an overall "Dead
   Rate." Reliability decisions need separate fields, such as "no-show,"
   "dead in auto," and "broke down during the match."
6. **Accuracy is teleop-only.** Auto misses aren't recorded, so accuracy
   ignores them.
7. **No offline resilience.** No queue, no draft saving, and identity is
   kept in `localStorage` (iOS can evict it). The new iPad app needs
   IndexedDB storage and a persistence request.
8. **Every summary scans the whole sheet.** Fine at event scale, but the
   dashboard should precompute a `Summary` so the 4pm screen loads fast.
9. **Photos are shared by public link** (`ANYONE_WITH_LINK`). Reasonable for
   thumbnails, but note it before treating scouting data as private.

*Issues 10–13 were found when the v3 source was added on 2026-10-03.*

10. **"Climb rate" counts attempts, not successes.** `getBotSummary` builds
    `endClimbRate`/`climbRate` from the `endgame_attempt` checkbox and never
    reads `endgame_level`. Also, the two fields don't depend on each other,
    so "Level 2" with "attempted" unchecked is possible. Climb reliability
    (a pick-list question) needs success by level, plus attempts.
11. **Silent defaults look like real data.** Start position defaults to
    "In front of Hub", role to "Scorer", cycle speed to 3, and endgame
    level to "None". A scout who skips a field records a believable value
    that nobody can tell from a real one. The new form should require an
    explicit choice for enums and ratings (stored as "not answered" until
    tapped).
12. **Auto fuel is a typed number field**, not steppers, so it's slow and
    two-handed. Use the same +1/+5/+10/−1 steppers as teleop.
13. **TBA failures are cached for 6 hours.** `getBotSummary` caches
    whatever `fetchPitTeamInfo` returns, error object included. Fix in the
    dashboard copy: only cache successful lookups.
14. **Names with apostrophes break the UI.** `index.html` builds
    `onclick="selectExistingScout('…','…')"` with `escapeAttr`. The browser
    turns `&#39;` back into `'` before the JavaScript runs, so a scout named
    "O'Brien" can't select their profile, and a crafted name could run
    script. The same pattern is used for teams and assignments. In the
    dashboard, attach event listeners instead of building inline handlers.
    (The new iPad app only ever inserts text as text.)

## Legacy match form enum values (from `index.html`)

| Field | Values (v3) |
|---|---|
| `auto_start_position` | In front of Hub · Left of Hub · Right of Hub |
| `fuel_pickup_source` | Floor · Depot · Outpost (multi-select, stored comma-joined) |
| `primary_role` | Scorer · Feeder · Defense |
| `cycle_speed` | 1 Very Slow … 5 Very Fast (default 3) |
| `endgame_attempt` | checkbox "Attempted Climb" |
| `endgame_level` | None · Level 1 · Level 2 · Level 3 |
| comp level picker | qm · qf · sf · f (scout-chosen, removed in new app) |

v3 theme: navy `#00004d`, gold `#FFD700`, background `#0a0a1a`, ⚡ in
the header, gold glow on active elements. The new app keeps this palette
so it still feels like the Warlocks app.

## Match record: what to transmit vs. derive

Legacy `MatchData` has 23 columns. For the QR record:

- **Transmit:** `app_version`, match key (with set number), `team_number`,
  `scout_id`, `station`, `timestamp`, auto-dead/no-show flags (see Issue 5),
  `auto_start_position` (enum), `auto_fuel_hub`, `auto_climb`,
  `teleop_fuel_hub_scored`, `teleop_fuel_hub_missed`, `cycle_speed` (1–5),
  `primary_role` (enum), pickup source (bit flags), `endgame_attempt`,
  `endgame_level` (enum), `notes` (length-capped), `checksum`.
- **Derive on the laptop:** `scout_name` (lookup by ID), `event_key`
  (config), `comp_level` and `match_number` (from the match key),
  `alliance` (schedule + team), `unique_key`.
- **Size:** counts, flags and enums encode into roughly 100–150 bytes before
  notes; capping notes keeps a single, easily scanned code. Measure the
  real number in Milestone 1.

## Mapping to the mentors' pick list filters

| Mentor filter | What the legacy data provides | Gap |
|---|---|---|
| Scoring | avg scored, avg auto fuel, accuracy (Review stats) | Agree on thresholds for the levels |
| Bot type | `primary_role` trend (Scorer / Feeder / Defense), pit `drive_type` | The wireframe used Scorer/Defender/Hybrid/Support; align the two sets |
| Bot strength | nothing direct; pit `overall_rank` is subjective | Define it (composite of scoring, reliability, climb?) |
| Fit with our bot | nothing | Needs our robot's gaps defined first |

## Recommended reuse plan

1. **Keep `Code.gs` as the dashboard backend.** Reuse the sheet names and
   headers, `getBotSummary`, `getCompareData`, the Alliance Board
   functions, the TBA helpers and caching. Add: a `doPost` sync endpoint
   with a shared secret, a `Mentor` tab (tags, rank, notes), a precomputed
   `Summary`, and an access allow-list. Remove the scout-facing and Admin
   screens from the public surface.
2. **Port the Match and Pit forms** into the new offline iPad web app
   (service worker, manifest, IndexedDB, QR output).
3. **Build the laptop core app** (new): QR intake, local database with
   dedupe, missing-scan list, sync queue, TBA fetch.
4. **Keep practice mode** for testing.

## Decisions needed

- **Record key:** include `scout_id` or not (Issue 3)?
- **Assignments:** station-based (one config QR per iPad) or per-match
  lists?
- **Schedule offline:** how does an iPad learn who plays in match N,
  including playoffs and mid-event changes? Options: load a schedule
  snapshot while online each morning/night, an updated schedule QR from the
  laptop, or a lead-authorized manual team entry.
- **Pit data and photos:** pit records have ~23 fields, two free-text
  fields and a photo. Options: (a) multi-frame QR for text and skip
  photos in-venue, (b) iPads store pit data and photos and upload them
  later on school or hotel Wi-Fi, (c) enter pit data at the laptop.
- **Alliance Board input:** scouts star teams in the dashboard on their own
  phones, or each match record includes a "would pick" rating that feeds
  consensus automatically?
- **Definitions:** "dead" fields (Issue 5), bot type categories, strength,
  and fit.
