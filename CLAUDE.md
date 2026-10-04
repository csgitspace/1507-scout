# Warlocks 1507 Scouting App — Refresh

## Purpose

This is a refresh of Team 1507's existing FRC scouting app. The mentor who
maintained the old version no longer has time to, so this refresh is built
with students taking real ownership: they should be able to read this file,
understand the system, and extend it themselves.

This is not just a coding project — it's a strategy tool. The app only
matters as far as it helps the team make better alliance-selection and
match-strategy decisions. See `docs/data-requirements.md` before changing
any scouting field — the "why" for each field lives there.

## Architecture (offline-first)

The team's working model, chosen specifically to avoid any team-run
wireless network at a venue (see Constraints below):

1. **Scout iPads** run an installed web app (added to the Home Screen),
   cached offline by a service worker. No network at all during matches.
   A scout fills out a match record, which is saved locally, then the app
   displays the record as a QR code.
2. **Scan station** — the scouting laptop, running the core scouting app,
   with a 2D imager (or webcam) reading each iPad's QR code. The laptop
   holds the local database (source of truth for raw scouting data) and
   aggregates records as they come in.
3. **Sync bridge** — a phone, USB-tethered to the laptop (cellular data
   only, no Wi-Fi hotspot). The laptop uses it to:
   - push new records out to the dashboard every few minutes (3–5 min
     target, to stay under the 10-minute staleness the mentors said is
     acceptable)
   - fetch The Blue Alliance API (schedule, match results, some match
     stats) on the same cadence
4. **Dashboard** — a Google Apps Script web app. Mentors and students open
   it on their own devices, on their own cellular/Wi-Fi, to view and
   annotate (not edit) the scouted data. See `docs/dashboard.md`.

Wireframe reference (pick list screen): see the design canvas from the
planning conversation — ask Chris for the link if it's not already in this
repo.

## Constraints — do not violate these without discussion

- **No team-run wireless network.** FRC Rule E301 is understood to prohibit
  teams from broadcasting their own Wi-Fi access points/hotspots at a
  venue. This is **not yet confirmed for the current season** — check
  `docs/rules.md` before assuming it's settled. The whole architecture
  above is built around this constraint (USB tether only, no hotspot).
- **Scouting data is never edited after the fact**, only superseded.
  Corrections are new records with the same match+team+scout key (last
  write wins) — never mutate a stored record in place.
- **Mentor annotations (tags, notes, pick order) live in a separate layer**
  from raw scouting data. A sync from the laptop must never overwrite a
  mentor's tag or note.
- **No manual event/station selection by scouts.** The scouting lead
  configures each iPad's event and station assignment (e.g. via a config
  QR code scanned once per iPad). Scouts never pick their own match or
  team to scout.
- **iPad records are never auto-deleted.** They stay on the device even
  after a successful scan, as the only backup if the laptop fails.
- **Every match record needs**: app version, event code, match number,
  team number, scout ID, station, timestamp, and a checksum — so the
  laptop can reject garbled or mismatched-version scans.

## Tech stack

- Scout iPad app: web app (HTML/JS), service worker for offline caching,
  manifest for standalone display mode, IndexedDB for local storage,
  QR generation library.
- Scouting laptop core app: Node.js, local database (SQLite unless this
  changes), QR decode (if using a webcam instead of a USB imager).
- Dashboard: Google Apps Script web app, backed by a Google Sheet (or
  migrate later if the team outgrows Sheets).
- Existing app (v3, in `legacy/`): a Google Apps Script web app
  (`Code.gs` + `index.html`) using a Google Sheet as its database. It is
  NOT Node/Express/SQLite, and every action needs internet via
  `google.script.run`. See `docs/legacy-audit.md` for what carries over,
  what changes, and known issues. Plan: keep `Code.gs` as the dashboard
  backend, port the Match/Pit forms to the offline iPad app, and build the
  laptop core app new.

## Definition of done for day one of competition

- A scout can fill out a match on an iPad in airplane mode, submit, and
  see a QR code, with zero crashes across a full match list.
- The scan station can read a code, store the record, and show a clear
  confirmation (or a clear rejection, with a reason).
- The scan station can list which station+match combinations have NOT
  been scanned yet, so the lead can catch missed matches.
- The sync job pushes to the dashboard and the dashboard reflects new
  data within the mentors' 10-minute freshness bar, with a visible
  "last synced" indicator.
- Nothing in the above requires venue Wi-Fi or a team-run network.

Anything beyond this (TBA fetch, award-scouting notes, elaborate
dashboard filtering) is valuable but not blocking for v1.

## Repo layout

```
scout-app/   iPad web app (static; deployed to GitHub Pages)
laptop/      scouting laptop core app (Node.js + SQLite)
dashboard/   Apps Script dashboard (built from a copy of legacy/Code.gs)
shared/      field config + record codec, used by scout-app AND laptop
docs/        specs, plans (docs/plans/), audit
legacy/      v3 Code.gs + index.html — reference only, never edit
```

## Decisions made (2026-10-03)

- **Record key** = match key (comp level + set + match number, e.g.
  `qm12`, `sf3m1`) + `team_number` + `scout_id`. Two scouts on the same
  team in the same match are both kept; the laptop flags the duplicate
  and summaries average them. A rescan from the same scout supersedes.
- **Assignments are station-based**, carried in a config QR scanned once
  per iPad (event + station, e.g. "Red 2 all event").
- **Schedule reaches offline iPads via a schedule QR** shown by the
  laptop (multi-part if needed; includes playoffs with set numbers). A
  lead-PIN manual team override exists as a fallback.
- **Scouting fields start from the 2026 (REBUILT) legacy set**, cleaned
  up per `docs/legacy-audit.md` (split "dead" into no-show / dead in
  auto / broke down; record auto misses). Fields are defined in ONE
  config file in `shared/` so the 2027 game is a config change in
  January, not a rewrite.
- **iPad app is hosted on GitHub Pages** (HTTPS is required for the
  service worker and the camera).
- **Branding:** Warlocks yellow and blue, lightning theme.

## Open questions (resolve before building the affected piece)

- Confirm E301 and how it's enforced — ask the event FTA about USB
  tethering specifically. See `docs/rules.md` (not yet written).
- Bot type categories and who assigns them (scout-entered vs. pit
  scouting).
- Definition of "strength" (capability vs. build quality vs.
  reliability).
- What gaps in our own robot "fit" should be computed against.
- Shared vs. per-mentor notes on the dashboard.
- 2D imager model — confirm it reads tablet screens before buying.
- Pit data and photos: multi-frame QR, upload later on school/hotel
  Wi-Fi, or enter at the laptop.
- Alliance Board input: scouts star teams on the dashboard, or a "would
  pick" rating in each match record.
- Align bot type categories (legacy: Scorer/Feeder/Defense) with the
  dashboard wireframe (Scorer/Defender/Hybrid/Support).

## Working style for this project

- Favor complete, ready-to-use pieces over partial scaffolding.
- Before changing scouting fields or the record format, check
  `docs/data-requirements.md` — fields should trace back to a decision
  the team actually makes at competition.
- When starting a new milestone, write a short plan first (what, why,
  how it'll be tested) before writing code.
