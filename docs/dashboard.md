# Mentor Dashboard Spec

## Who it's for, and what it's for

Mentors (and eventually students) open this on their own devices, on their
own cellular data or Wi-Fi — never on a team-run network. It is a read
layer over the scouting data, plus a separate annotation layer mentors can
write to.

**Hard rule: the dashboard never edits scouted data.** Mentors tag, rank,
and note — they don't change a scout's submitted numbers. If a correction
is needed, it comes from the laptop as a new record (see
`CLAUDE.md` → Constraints).

## Screen 1 — Pick list (the "4pm Saturday" screen)

This is the screen mentors said they'd want open during alliance
selection. A wireframe exists on a design canvas from the planning
conversation — ask Chris for the link.

**Filters** (combinable):
- Scoring level
- Bot type
- Bot strength
- Fit with our bot (how complementary a team is to our robot's gaps)

**Per-team row shows:**
- Rank (mentor-draggable)
- Team name/number
- Scoring level (read-only, from scouted data)
- Bot type (read-only)
- Strength level (read-only)
- Fit level + a short "why it fits" reason (computed — see below)
- Tag (mentor-editable: Target / Backup / Avoid / none)
- Note (mentor-editable, free text)

**Sync indicator:** "Synced [N] min ago," visually flagged once it passes
the 10-minute staleness bar.

**Fit computation:** needs our own robot's current gaps/weaknesses defined
by mentors as an input (not scouted data) — pending from the open
questions in `CLAUDE.md`.

## Other screens (not yet speced — build after Screen 1)

- **Next match** — six-team brief: side-by-side stats, recent matches,
  scout notes, for whichever match is up next.
- **Data health** — which station+match combinations are missing a scan,
  version mismatches, last-synced time. This is what lets a lead catch a
  scout who missed a match.

## Architecture

- **Store:** Google Sheet.
  - `Raw` tab — append-only, protected, written only by the laptop's sync
    job. This is the scouted data, one row per record (keyed by
    match+team+scout).
  - `TBA` tab — schedule/results pulled from The Blue Alliance.
  - `Mentor` tab — tags, ranks, notes. Written only by the dashboard, never
    by the sync job.
  - `Summary` tab — precomputed aggregates the dashboard reads from,
    rather than recomputing on every page load.
- **Sync job (on the scouting laptop):** batches new/changed records and
  POSTs them to an Apps Script web app endpoint over the USB-tethered
  phone's cellular connection. Include a shared secret/token so only the
  laptop can write. Retries safely — records are keyed, so a duplicate
  push is harmless.
- **Front end:** an Apps Script web app, phone-friendly, reading from the
  `Summary` tab rather than issuing many small calls.
- **Access control:** restrict to a specific list of mentor/student Google
  accounts. Test with a non-district Google account, since mentors likely
  aren't inside the school's Workspace domain. Scouting data is
  competitive — don't make the Sheet or web app link public.

## Open questions

- Shared mentor notes, or per-mentor private notes?
- What counts as "fills a gap" — needs our own robot's weaknesses defined.
- Does the team want this to stay on Sheets long-term, or is this a v1
  that gets replaced by a proper hosted database + dashboard later if the
  team outgrows it?

## Reuse of the legacy backend

The v3 `Code.gs` (see `docs/legacy-audit.md`) already has most of the
dashboard's data layer: sheet helpers, TBA fetch with caching, per-team
summary stats (`getBotSummary`), two-team compare (`getCompareData`), and
the favorites / consensus board. Plan to build the dashboard from a copy of
it rather than from scratch:

- Keep the legacy sheet names and headers (`MatchData`, `PitData`,
  `Teams`, `Matches`) so the existing summary logic keeps working. The
  `Raw` / `Summary` / `Mentor` tabs described above are additions, not
  replacements.
- Add a `doPost` sync endpoint (shared secret) for the laptop.
- Add the `Mentor` tab and the pick list screen.
- Add an access allow-list, and remove the Admin tab and the scout-facing
  forms from the public surface.
- Legacy "scout favorites" (the Alliance Board) can become a "scout
  favorites" count column on the pick list, once its input path is decided.
