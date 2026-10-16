# Future plans

Ideas for after Rah Cha Cha Ruckus (2026-10-17) that we don't want to lose.
Each one says **why** it matters, a rough **how**, and how big it is, so a
student can pick one up. When you start one, write a plan in `docs/plans/`
first (CLAUDE.md, "Working style"), then move it to "Done" below.

Size: **S** = an evening · **M** = a weekend · **L** = several weekends.

| # | Idea | Size | Needs a team decision first? |
|---|---|---|---|
| 1 | [Game configuration screen (no code changes each January)](#1-game-configuration-screen) | L | Yes: which roles the summary needs |
| 2 | [Archive an event / start a new one](#2-archive-an-event-and-start-a-new-one) | M | No |
| 3 | [Faster pick list: server-side cache](#3-faster-pick-list-server-side-cache) | M | No |
| 4 | [Define Strength, Fit and bot types](#4-define-strength-fit-and-bot-types) | S (code) | **Yes**: scouting leads |
| 5 | [Pit photos](#5-pit-photos) | M | Yes: how photos travel |
| 6 | [Auto start conflicts in the alliance builder](#6-auto-start-conflicts-in-the-alliance-builder) | S | No |
| 7 | [Claims vs. reality](#7-claims-vs-reality) | S | No |
| 8 | [Protect the official pick list in the Sheet](#8-protect-the-official-pick-list-in-the-sheet) | S | No |
| 9 | [Alliance Board input (who scouts would pick)](#9-alliance-board-input) | M | Yes |
| 10 | [Multi-day events: trends and more charts](#10-multi-day-events-trends-and-more-charts) | M | No |
| 11 | [Award scouting notes](#11-award-scouting-notes) | S | Yes: which awards |
| 12 | [Keep guides and screenshots up to date automatically](#12-keep-guides-and-screenshots-up-to-date) | S | No |
| 13 | [Hardware and rules to settle](#13-hardware-and-rules-to-settle) | n/a | Yes |
| 14 | [Small polish](#14-small-polish) | S | No |

---

## 1. Game configuration screen

**Why.** Every January the game changes. Today a student edits
`shared/fields.js` (match and pit questions) and the FIELD-DEPENDENT parts
of `dashboard/common/Summary.js` (how fuel, climbs etc. become pick-list
numbers), then pushes code. A **Game setup** tab on the scan station would
let the scouting leads set up next year's questions without touching code.

**How (sketch).**
1. **Fields as data.**
   - Move `FIELDS` / `PIT_FIELDS` out of code into a JSON "game config"
     saved on the laptop (settings table), with today's 2026 lists as the
     starting point.
   - The station tab edits it: add, reorder or remove a question; set its
     type, options, required, tab and help text.
   - Keep the field types the app already supports (bool, counter, enum,
     multi, rating, text).
2. **Get it to the iPads.**
   - The laptop shows a multi-part **form QR**, built the same way as the
     schedule QR (`shared/setup-codes.js` already handles parts and
     revisions).
   - The iPad stores the config and renders the form from it (`form.js`
     already renders from field definitions).
   - Replace the hand-bumped `SCHEMA_VERSION` with a short hash of the
     config. Every record carries it, and the laptop rejects a record
     whose hash doesn't match: the same protection as today, automatic.
3. **Make the summary generic (the hard part).**
   - The summary has to know what each field *means*, so each field gets
     an optional **role**:
     - `scored` / `missed` (counters, with `auto` or `teleop`)
     - `climb_level` (enum, ordered)
     - `no_show`, `broke`, `dead`
     - `role` (Scorer / Feeder / Defense)
     - `start_position`, `route`, `rating`, `notes`
   - `observe_()` in Summary.js then reads fields by role instead of by
     name ("auto_fuel_scored").
   - Labels on the dashboard ("fuel", "climb L3") come from the config too.
4. **Dashboard.** Send the game config with the sync (like the schedule)
   so the Apps Script side builds the Raw / Pit columns from it instead of
   the generated `Fields.js`.

**Watch out for.**
- Changing the config mid-event splits the data: older records have a
  different hash. Lock the config once the event starts, or require a new
  event code.
- Test with a fake "2027 game" with different counters before trusting it.

**Size: L.** Do it in a quiet month (November–December) so it's ready
before kickoff.

## 2. Archive an event and start a new one

**Today.**
- **Laptop:** everything is stored per event code, so a new event code on
  Event setup already starts fresh, and old records stay in the database
  (append-only, never deleted).
- **Google Sheet:** Raw, Summary and Pit are per event, but the pick team's
  tabs are not. These would carry over into the next event:
  - **Mentor**: official order, tags, shared notes, Picked
  - **MentorPrivate**
  - **MyPicks**
  - Config "Our robot needs"
- **Manual workaround until this is built:** in the Sheet, File → Make a
  copy named e.g. "Scouting – 2026rcc archive", then clear those tabs.

**How.**
- **Dashboard:**
  - A **Start new event** button (team account only), or automatic when
    the sync endpoint sees a new event code.
  - It copies Mentor / MentorPrivate / MyPicks to "<event> archive" tabs
    (protected, read-only), then clears them and the gaps.
  - Teams / Matches / External / Results are already overwritten by the
    next event's sync.
- **Laptop:**
  - An **Archive event** button that saves a dated copy of the database
    (`backupTo()` already exists) plus both CSVs to
    `data/archive/<event>/`.
  - An event picker so a past event can be viewed read-only (records,
    coverage, pit).
- **iPads:** nothing to do. Records stay forever, and scanning a new
  config code switches events.

**Size: M.**

## 3. Faster pick list: server-side cache

**Why.**
- Milestone 6 cut each load from ~40 Sheets calls to ~10 and added the
  instant saved copy.
- The first load on a new phone, and every refresh, still read the whole
  Sheet.

**How.**
- Cache the shared part of `getPickList` (Summary + External + Mentor +
  Pit + Config) in Apps Script's `CacheService` under a version key.
- The sync endpoint and every pick-lead save bump the version.
- Per-person data (private notes, My list) is still read live.
- Cache entries max out at 100 KB, so split the data across several keys
  if needed.

**Size: M.** Measure first: open Executions in the Apps Script editor
and compare `getPickList` durations before and after.

## 4. Define Strength, Fit and bot types

**Needs the scouting leads**: these are open questions in CLAUDE.md, and
the dashboard labels them "draft".
- **Strength:** capability, build quality or reliability? It's currently
  scoring rank × reliability (`DRAFT.strength` in Summary.js).
- **Fit:** which gaps in our robot, and how much each matters. Gaps
  currently all weigh the same.
- **Bot types:** legacy Scorer / Feeder / Defense vs. the wireframe's
  Scorer / Defender / Hybrid / Support. Pick one set, then use it in the
  form *and* the dashboard.

**Code change once decided:** small. Everything is in the `DRAFT` block
at the top of `dashboard/common/Summary.js`, which was written so the
leads can change it.

## 5. Pit photos

**Why.** A photo of each robot helps the pick team remember who's who at
4pm.

**Options** (still open in CLAUDE.md):
- (a) iPad photos uploaded later over school or hotel Wi-Fi
- (b) photos taken at the laptop with its webcam during pit visits
- (c) multi-frame QR codes, which are slow for photos

(b) is the simplest offline option. (a) needs an upload path into Drive.

**Size: M.**

## 6. Auto start conflicts in the alliance builder

**Why.** Two partners whose best autos both start "Left of Hub" can't both
run them.

**How.**
- The alliance builder already knows each team's best auto
  (`auto_starts`) and the pit's claimed starts.
- Add **our** preferred start, as a setting under "Our robot needs".
- Flag a collision ("⚠ 254 and 1678 both want Left of Hub"), and suggest
  each partner's next-best start that doesn't collide.

**Size: S.**

## 7. Claims vs. reality

**Why.** Pit answers are claims. We already show "Trench (pit says; not
seen in 3)". Do the same for climbing and autos.

**How.** Card badges like:
- "Claims L3, reached L3 in 1 of 5"
- "Claims 8-fuel auto, best scouted 4.5"

**Size: S.**

## 8. Protect the official pick list in the Sheet

**Why.** Known limit from Milestone 5: pick-team members have Editor
access to the Sheet, so someone could change the official list directly
in Google Sheets.

**How.**
- The pick-lead saves go through a small "writer" web app that runs as
  the team account. The **Mentor** tab is then protected to the team
  account only.
- Viewers keep Editor access only for their own private notes and My
  list.

**Size: S–M.**

## 9. Alliance Board input

Open question in CLAUDE.md. Either:
- scouts star teams on the dashboard, or
- each match record gets a "would you pick this robot?" rating.

The rating is cheap to add (one `rating` field) and averages naturally.

**Size: M** (mostly agreeing on what the question means).

## 10. Multi-day events: trends and more charts

**Why.**
- At district or regional events teams play 10–12+ quals over 2–3 days,
  enough for trends to mean something.
- Match-by-match lines exist (Analyze → Compare) but only for chosen
  teams.

**Ideas:**
- "Improving / fading" badge: the slope of the last 5 matches vs. the
  first 5
- Day-by-day averages
- A trench / bump route chart
- A chart of auto start positions across the event

**Size: M.**

## 11. Award scouting notes

From CLAUDE.md's "valuable but not blocking": a place to record standout
behavior for awards (e.g. Engineering Inspiration). Could be a third
iPad mode like pit mode, or a dashboard note type.

**Size: S** once the team decides which awards matter.

## 12. Keep guides and screenshots up to date

**Why.** The pick-list guide (`docs/handoff/Pick-List-User-Guide.pdf`)
uses phone screenshots of a sample event. Every UI change makes them
stale.

**How.**
- Move the scripts used on 2026-10-15 into `tools/`:
  - a sample-event generator that feeds the real dashboard code through
    the test fake Sheet
  - a headless-Chrome screenshot script (Chrome DevTools Protocol, no npm
    packages)
  - the PDF print command
- Add `npm run guides`, which rebuilds every screenshot and PDF.
- Pushing the PDFs re-publishes them to GitHub Pages under `/guides/`.

**Size: S.** Also worth writing the other guides suggested in
`docs/handoff/BRIEF.md` section 11 (scout quick card, lead runbook).

## 13. Hardware and rules to settle

- **E301:** confirm with the event FTA that USB tethering a phone to the
  laptop is fine. The whole design avoids Wi-Fi hotspots because of this
  rule.
- **USB imager:**
  - Pick one that reads phone and tablet screens and has a Unicode or
    serial mode. Keyboard-mode imagers can garble emoji or accented
    letters in notes.
  - Test one before buying.
  - Pit records are denser QR codes than match records, so test both.

## 14. Small polish

- **Compare table:** a row where everyone has 0% (e.g. Level 3 climb)
  highlights all of them gold. Highlight only values above 0.
- **Pick list header:** the four buttons wrap to two lines on narrow
  phones. Shorter labels or icons would fix it.
- **Lead tools page** (`scout-app/lead.html`, the backup when the laptop
  is unavailable): its Pit scout code has no team list. Let it take one
  from the schedule box.

---

## Done (moved here when finished)

- 2026-10-15 · Milestone 6: faster loading, Analyze charts, Picked / Best
  available (`docs/plans/m6-analyze-and-speed.md`)
- 2026-10-15 · Milestone 7: pit scouting mode, trench/bump routes, best
  auto (`docs/plans/m7-pit-and-routes.md`)
- 2026-10-15 · Milestone 8: match13 xP, forecasts, projected ranks, and
  the Lookup team screen (`docs/plans/m8-match13-and-lookup.md`)
