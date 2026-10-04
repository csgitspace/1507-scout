# Milestone 3 — Sync + Mentor Dashboard

## Status (2026-10-04): built and tested locally; Google deployment pending

**Done and passing (`npm test`, 50 tests):**
- The dashboard's Apps Script code runs in Node against an in-memory fake
  of the Sheets API (`tests/helpers/fake-apps-script.js`):
  - the token check
  - safe re-sends
  - corrections superseding while every version stays in Raw
  - mentor tabs never touched by the sync
  - scout and mentor text can't become Sheets formulas
  - summary math (two scouts averaged, auto misses in accuracy, climb
    success by level, no-shows separate)
  - scoring thirds
  - private notes hidden from other mentors
  - ranking and fit
- Laptop sync: batching, retry after the phone drops, nothing resent once
  confirmed, schedule sent only when it changes, and an end-to-end run of
  laptop → real sync-endpoint code → Sheet.
- Visual check: the pick list renders correctly at phone width (390 px)
  with real summary data.
- The station's browser test still passes, now with the Dashboard sync
  panel.

**Also added, beyond the plan:**
- Text starting with `=`, `+`, `-` or `@` is stored as plain text, so a
  scout note can't run as a formula in the team's Sheet.
- Team 1507 is left off its own pick list.

**Still to do (needs the team Google account):** `dashboard:create`, then
`dashboard:push`, then the real-Google tests below.

## What

1. **Sync job** on the scan station. Every 3 minutes it pushes new records
   (plus the schedule and team list) over the tethered phone to Google.
2. **Mentor dashboard**, a Google Apps Script web app backed by a Google
   Sheet in the team account. Mentors open it on their own phones:
   - the **pick list**: filters, a rank they can drag, a Target / Backup /
     Avoid tag, a shared note and a private note
   - a **"Synced N min ago"** indicator that turns red past 10 minutes

## Why

Day-one definition of done, item 4: "The sync job pushes to the dashboard
and the dashboard reflects new data within the mentors' 10-minute freshness
bar, with a visible 'last synced' indicator." The pick list is the
"4pm Saturday" screen (`docs/dashboard.md`).

## Decisions (2026-10-04)

- **Owner: the team Google account.** It owns the Sheet and both scripts,
  so the dashboard outlives any one mentor.
- **Deploy with clasp.** The repo is the source of truth;
  `npm run dashboard:push` uploads it.
- **Notes: both.** One **shared** note per team, stamped with who edited it
  last, plus a **private** note per mentor.

## How

### Two small Apps Script projects (why two)

The laptop can't sign in to Google, so it needs an endpoint anyone can
POST to. Mentors, on the other hand, must be on an allow-list. One Apps
Script deployment can't do both, so:

| Project | Runs as | Who can reach it | Job |
|---|---|---|---|
| `dashboard/sync-endpoint/` | the team account | anyone, but every request must carry a **secret token** | receives records from the laptop and appends them to `Raw`; rebuilds `Summary` |
| `dashboard/web/` | **the mentor viewing it** | Google-signed-in users the Sheet is shared with | the pick list UI, and writes tags/notes |

**The allow-list is the Sheet's sharing list.** The web app runs as the
person viewing it, so only people the Sheet is shared with can load data.
Add or remove a mentor by sharing or unsharing the Sheet. No
`ANYONE_WITH_LINK` sharing anywhere (legacy Issue 9). The sync endpoint
only accepts writes and never returns scouting data, so the token protects
the only open door.

*Cost:* the first time each mentor opens the dashboard, Google asks them to
authorize it, and may show an "unverified app" screen. That happens once
per mentor and will be in the setup guide.

### Google Sheet tabs

| Tab | Written by | Contents |
|---|---|---|
| `Raw` | sync endpoint only (protected range) | one row per record version: metadata + one column per field; never edited |
| `Summary` | sync endpoint | one row per team, precomputed so the pick list loads fast (legacy Issue 8) |
| `Teams`, `Matches` | sync endpoint | the laptop's TBA import (legacy names kept) |
| `Mentor` | dashboard | per team: rank, tag, shared note, last editor, time |
| `MentorPrivate` | dashboard | per mentor + team: private note |
| `Config` | both | last sync time, event, "our robot's gaps" for fit |

The sync never touches `Mentor` or `MentorPrivate` (`CLAUDE.md` rule).

**Honesty about "private":** private notes are hidden from other mentors in
the dashboard. Anyone the Sheet is shared with could still open the
`MentorPrivate` tab in Google Sheets. True privacy would need a separate
store; flag it if that matters.

### Sync job (laptop)

- `laptop/sync.js` runs every **3 minutes**, plus a **Sync now** button.
- It sends the records not yet confirmed (up to 300 per request), the
  schedule and teams when they've changed, and the token.
- The endpoint de-duplicates on the record's QR text, appends only new
  rows, rebuilds `Summary`, records the sync time, and replies with the
  IDs it has.
- Confirmed IDs go in a new `sync_log` table. `records` itself stays
  append-only.
- **Safe to retry:** if a push half-fails or the phone drops, the next run
  resends, and duplicates are ignored on the Sheet side.
- **Station screen:** shows "Last sync 2 min ago ✓" or "Sync failing:
  can't reach Google (phone tethered?) — 14 records waiting". The URL and
  token are entered on Event setup and stored only in `data/`.

### Summary + pick list (ports v3's `getBotSummary`, with its issues fixed)

Per team (from current records, averaging two-scout duplicates):
- matches scouted
- average auto / teleop fuel scored
- **accuracy including auto misses** (Issue 6)
- **climb success rate by level**, plus attempt rate (Issue 10)
- **no-show, dead-in-auto and broke-down rates, kept separate** (Issue 5)
- role trend, average cycle speed, latest notes, last match

Pick list columns and filters (`docs/dashboard.md`):

| Column | M3 definition | Status |
|---|---|---|
| Scoring level | High / Mid / Low = top, middle, bottom third of the event by average total fuel scored | default; mentors can change the cut points |
| Bot type | role trend: Scorer / Feeder / Defense, or Hybrid when no role is above 55% | aligns v3 roles with the wireframe's "Hybrid"; **"Support" needs a definition** |
| Strength | **draft:** reliability (no breakdowns/no-shows) × consistency, as High/Mid/Low | **open question; marked "draft" in the UI** |
| Fit + reason | mentors tick our robot's gaps (needs defense, needs L3 climb, needs auto scoring, needs feeder); each team is scored on matching strengths, with a reason like "L3 climb 80%" | gaps are entered by mentors; **formula is a draft** |
| Rank, tag, shared + private note | mentor-edited, saved immediately | |

The strength and fit formulas live in one clearly marked block of
`Summary.js`, so the scouting leads can change them without touching
anything else.

### Single source of truth for fields

`npm run dashboard:build` generates `dashboard/*/Fields.js` from
`shared/fields.js`. Apps Script can't import the repo's modules, so this
generated copy carries the same labels and options; it is never edited by
hand. `dashboard:push` runs the build and then clasp.

### What carries over from v3 `Code.gs`

- sheet helpers (`getSheet_`, `ensureHeaders_`, `headerMap_`, `withDocLock_`)
- the summary logic (fixed as above)
- the Review screen's layout ideas

Left out, as planned:
- the scout-facing forms
- the Admin tab and the TBA fetch (the laptop does these now)
- the Alliance Board, until its input path is decided (Issue 4 goes away
  with it)

## How it'll be tested

1. **Automated** (`npm test`):
   - the laptop sync against a fake endpoint: batching, retry after
     failure, nothing resent once confirmed, schedule sent only when changed
   - `Summary.js` run in Node (it's plain JavaScript) on a fixture event:
     averages, accuracy with auto misses, climb success by level, tiers,
     duplicates averaged
2. **Against real Google, from the laptop over the phone tether:**
   - 20 scanned records reach the Sheet within one sync
   - pull the tether → the station shows "failing / N waiting" → reconnect →
     it catches up with no duplicate rows
3. **Mentor check:**
   - a mentor with a **non-district** Google account opens the dashboard on
     their phone and tags, ranks and notes
   - a second mentor sees the shared note, not the private one
   - an account the Sheet isn't shared with is refused
   - "Synced N min ago" turns red after 10 minutes with the laptop off

## One-time setup (you, with the team account)

1. Turn on the Apps Script API: <https://script.google.com/home/usersettings>.
2. In the project folder: `npm.cmd install -g @google/clasp`, then
   `clasp.cmd login` (the team account).
3. I'll script the rest: creating the Sheet and both projects
   (`npm run dashboard:create`), pushing, and deploying. You'll then copy
   two URLs and the token into the station's Event setup.

## Open questions (don't block M3, but needed for a trustworthy pick list)

- **Strength:** confirm or replace the draft formula (capability vs.
  reliability vs. build quality).
- **Fit:** the list of "our robot's gaps" mentors can tick.
- **Bot type:** what makes a robot "Support"?
- Should the dashboard stay on Sheets long-term?
