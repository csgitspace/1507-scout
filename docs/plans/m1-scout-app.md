# Milestone 1 — Offline iPad Scout App

## Status (2026-10-03): built, desktop-tested; iPad testing pending

**Done and passing:**
- `npm test`: 21 tests, including a real QR encode → image → jsQR decode.
  - Typical record: 112 bytes (QR version 8). Worst case: 307 bytes.
  - An 80-match schedule fits in 7 QR parts of ≤ 379 bytes each.
- Headless-Chrome run at iPad Air size, all through the real UI:
  - set up from a config QR, then load a schedule (parts scanned in reverse)
  - submit is blocked while required fields are unanswered
  - a mid-match reload restores the draft
  - 20 matches scouted, plus a correction that supersedes the original
  - the QR drawn on screen decodes correctly (emoji in notes, pipe sanitized)
  - lead PIN check works
  - reloads with the network off and the app still loads from cache
  - no console errors

**Still to do, on real hardware** (see "How it'll be tested" below):
- the airplane-mode run on an installed iPad
- the force-quit and reboot persistence checks
- scanning a QR off the iPad screen with the chosen imager

**As built, vs. the plan below:**
- The config QR carries the PIN as plain digits, not a hash. A 4-digit hash
  can be brute-forced instantly, so hashing added nothing. The PIN only stops
  casual changes.
- Schedule parts hold 12 matches each.
- On Home, scouts can step ◀ ▶ between matches so they can catch up to the
  match on the field. The team is always derived from schedule + station;
  only the lead (PIN) can override a team or add a match by hand.
- The lead menu also has "Show all QR codes", which replays every record so
  the laptop can rebuild its data from an iPad.

## What

An installable web app for the scout iPads that works with **no network
at all**: set up once by a config QR, learns the schedule from a schedule
QR, walks a scout through a match, saves the record on the iPad, and shows
it as a QR code for the scan station.

## Why

It's the first item in the day-one definition of done (`CLAUDE.md`): "A
scout can fill out a match on an iPad in airplane mode, submit, and see a
QR code, with zero crashes across a full match list." Nothing downstream
(laptop, dashboard) has data until this works.

## How

### Files

```
shared/
  fields.js        the ONE place scouting fields are defined (2026 set)
  codec.js         record <-> QR text, CRC32 checksum, version check
  config-codec.js  config QR + schedule QR formats
scout-app/
  index.html, app.js, styles.css
  manifest.webmanifest, sw.js, icons/   (lightning bolt, yellow on blue)
  vendor/          qrcode-generator (QR out), jsQR (camera QR in), MIT
  lead.html        lead tools: make config + practice-schedule QR codes
                   (stand-in until the laptop app generates them in M2)
tests/
  codec.test.js    node:test, runs shared/ code directly in Node
.github/workflows/pages.yml   deploy scout-app/ + shared/ on push
```

No build step and no framework: plain ES modules, so a student can open
any file and read it. `shared/` runs unchanged in the browser and in Node,
so the laptop decodes with the exact code the iPad encodes with.

### Screens (one-handed, big tap targets, portrait)

1. **Setup** (first run): "Scan the config QR from your scouting lead."
   Sets event, station (R1–B3) and the scout roster.
2. **Who's scouting?** Scouts rotate shifts, so the scout picks their own
   name from the roster at the start of a shift. Event, station and
   match/team still come from the lead. Scouts never pick these.
3. **Next match**: big "Q12 · RED 2 · Team 1507", Start button. The team
   comes from schedule + station. Manual team override sits behind the lead PIN.
4. **Match form**: Pre → Auto → Teleop → Endgame → Notes, as swipeable
   sections. Big +1/+5/+10 steppers (kept from v3), toggles, 1–5 ratings.
   Every tap saves a draft to IndexedDB, so a crash or reload loses nothing.
5. **QR screen**: large code, record summary, "Next match →".
6. **History**: every record on the device, re-show any QR. Records are
   never deleted. "Correct this record" makes a new record with a newer
   timestamp, which supersedes the old one at the laptop.

### Fields (2026, cleaned up per the legacy audit)

Pre: `no_show`. Auto: `auto_start_position`, `auto_fuel_scored`,
`auto_fuel_missed` *(new: fixes accuracy ignoring auto misses)*,
`auto_climb`, `dead_in_auto`. Teleop: `teleop_fuel_scored`,
`teleop_fuel_missed`, `pickup_sources` (bit flags), `primary_role`,
`cycle_speed` (1–5), `broke_down` *(new)*. Endgame: `endgame_attempt`,
`endgame_level`. Notes: `notes` (capped at 200 characters).

Enum values match v3 (see the table in `docs/legacy-audit.md`):
start position In front of / Left of / Right of Hub; pickup Floor /
Depot / Outpost; role Scorer / Feeder / Defense; endgame level None /
L1 / L2 / L3. Changes from v3:

- **No silent defaults** (audit Issue 11): enums and ratings start as
  "not answered". Submit is blocked until required fields are answered
  or the scout checks no-show.
- **Auto fuel uses steppers** like teleop (Issue 12).
- `endgame_level` records the level actually reached. `endgame_attempt`
  is kept, so the laptop can compute both success rate and attempt rate
  (Issue 10).

All of these live in `shared/fields.js` and are swapped out when the
2027 game is revealed.

### Record format (QR text)

Pipe-delimited, field order taken from `fields.js`, with a CRC32 checksum at the end:

```
W|<app_ver>|<schema_ver>|<event>|<match_key>|<team>|<scout_id>|<station>|<unix_ts>|<field values…>|<crc32>
```

Expected size is ~80–120 bytes before notes and under 350 bytes with full
notes, which makes a low-density code that's easy to scan. The laptop
rejects a scan with a reason if: the checksum fails, `schema_ver` doesn't
match, or the event is wrong.

**Config QR:** `WCFG|<ver>|<event>|<station>|<lead_pin>|<roster id:name;…>|<crc32>`
**Schedule QR:** `WSCH|<ver>|<event>|<part>/<total>|<match_key>:r1,r2,r3,b1,b2,b3;…`
About 15 matches per part. The iPad shows "3 of 6 parts scanned" and
accepts parts in any order.

### Storage

IndexedDB stores `config`, `schedule`, `records`, `draft`. On setup the app
calls `navigator.storage.persist()`, plus Home Screen install, so iOS
doesn't evict the data. No `localStorage` for anything important (legacy
Issue 7).

### Theme

Carries over the v3 palette (navy `#00004d`, gold `#FFD700`, near-black
`#0a0a1a`) and ⚡ identity, so it still feels like the Warlocks app.
Adds a lightning-bolt Home Screen icon and bolt dividers between form
sections. High contrast so it reads under arena lighting.

## How it'll be tested

1. **Automated** (`node --test`): round-trip encode/decode for every field
   type, a flipped byte fails the checksum, a wrong schema version is
   rejected, a max-length record stays under the size budget, and
   playoff keys (`sf3m1` vs `sf3m2`) don't collide.
2. **Airplane-mode run** (the definition-of-done test): install from
   GitHub Pages, turn on airplane mode, scan a config QR and a practice
   schedule (20 matches, from `lead.html`), scout all 20 matches. No
   crashes, all 20 records in History.
3. **Persistence**: force-quit mid-match → draft restored. Reboot iPad →
   records and config still there.
4. **Scannability**: read the QR off an iPad screen with a phone camera
   and (once chosen) the 2D imager, at full screen brightness, with notes
   filled to the cap.

## Open items for this milestone

- Copy the full `legacy/index.html` file into the repo. The chat paste
  was cut off, but the Match form part arrived, so this doesn't block M1.
- Confirm the "scout picks their own name at shift start" approach (vs.
  a re-scanned config QR per scout).
- A GitHub account/org for the repo + Pages site (team-owned, so it
  outlives any one mentor).
