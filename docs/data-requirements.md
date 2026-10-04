# Data Requirements — "Begin With The End"

This is the design process the scouting leads worked through. **Every field
in the app should trace back to a decision in the table below.** If a field
doesn't, cut it or justify it here first.

Core principle: we are not designing a form. We are designing a
decision-making tool that happens to have a form as its input. Polish is
not a substitute for purpose — a beautiful form that asks the wrong
questions is worse than an ugly form that asks the right ones.

## The reverse-engineering chain

1. **What decisions get made at competition?**
   Alliance selection / pick list, match strategy adjustments, identifying
   broken or unreliable robots, scouting for awards (e.g. Engineering
   Inspiration).
2. **What questions do those decisions require answers to?**
   Who scores fastest in auto? Who plays defense well? Whose climb is
   reliable? Who tips over or breaks down?
3. **What raw data answers those questions?**
   Counts, times, booleans, scales, notes.
4. **How do we capture that raw data in ~2 minutes per match, one-handed,
   on an iPad, without missing anything?**
5. **Only now: what does the screen look like, what buttons, what layout?**

## Decision → data traceability table

Fill this in with the scouting leads before finalizing the record format.

| Decision it supports | Question it answers | Raw data type | Field name | Notes |
|---|---|---|---|---|
| Pick list | Scoring output | count/scale | `scoring_level` | definition TBD with mentors |
| Pick list | Bot type | enum | `bot_type` | categories TBD |
| Pick list | Build/reliability | scale | `strength_level` | "strength" definition TBD |
| Pick list | Fit with our bot | computed | `fit_level`, `fit_reason` | needs our own robot's gaps defined first |
| Match strategy | Defense capability | boolean/scale | | |
| Match strategy | Climb/endgame reliability | enum | | |
| Robot reliability | Breakdowns | boolean + note | | |
| Awards scouting | Standout behavior | free text | | |
| Data health | Was this match scouted? | derived | | from match+team+scout coverage |

*(This table is a starting skeleton — the scouting leads should expand it
field by field before the record format is frozen.)*

## Discussion questions (for the scouting team planning session)

### Stage 1 — Decisions
- What decision have we regretted making, or wished we'd made better, in
  past seasons?
- If you could only know three things about every other team before
  alliance selection, what would they be?

### Stage 2 — Questions behind the decisions
- What's the difference between a team that "looks good" and a team that
  actually helps us win? What data separates those?
- What have we been burned by before — a team that scouted well on paper
  but failed at competition?

### Stage 3 — Raw data
- For each stat we want, ask: can a scout capture this in the time
  available, or are we asking for too much precision?
- Is this a count, a yes/no, a timer, or a note? (Different data types
  drive different UI controls later.)

### Stage 4 — Collection method
- Can a scout who's never used the app before fill this out correctly on
  their first match?
- What's the minimum viable form — what can we cut without losing
  decision-making power?
- Is there data we can have compiled into decision reports for us behind
  the scenes by the app?

### Stage 5 — Then, and only then, UI
- Now that we know the fields, what's the fastest possible tap-path
  through them during a live match?

## Record format requirements (from the offline/QR architecture)

Independent of which fields end up in the form, every record needs:

- `app_version` — so the scan station can reject mismatched versions
- `event_code`
- `match_number`
- `team_number`
- `scout_id`
- `station`
- `timestamp`
- `checksum` — to catch garbled scans
- A unique key of `match_number + team_number + scout_id`, so a rescanned
  code updates the existing record instead of duplicating it

Keep each record small — a dense QR code scans poorly. Aim for a few
hundred bytes. If free-text notes get long, split them into a second code
rather than bloating the primary record.

## Mentor dashboard requirements (from the mentor-needs discussion)

The 4pm Saturday screen mentors want is the **pick list**, filtered by:

- Scoring
- Bot type
- Bot strength
- How complementary a team is to our own bot ("fit")

Mentors annotate (tag, rank, note) but never edit scouted data — see
`docs/dashboard.md` for the full spec.

Data freshness: **10 minutes is the acceptable staleness bar.** Target a
3–5 minute sync cadence so a single missed push doesn't blow the budget.

## Starting point: the legacy fields

`docs/legacy-audit.md` lists every field the previous app collected, which
ones can be derived instead of transmitted, and which pick-list filters
have no data behind them yet (strength, fit). Fill in the traceability
table above by starting from those fields: keep what traces to a decision,
cut what doesn't, add what a decision needs and the legacy form lacks.
