// ==============================================================================
// "Which station + match combinations haven't been scanned?" (CLAUDE.md,
// definition of done #3)
//
// coverage(schedule, records, { playedThrough }) builds a grid of matches x
// stations. Each cell is one of:
//   ok        scanned
//   missing   no record yet
//   multi     two or more scouts recorded this robot (all kept)
//   mismatch  a record exists, but for a different team than the schedule says
// Only matches up to `playedThrough` are shown. That's the last match that has
// actually been played; by default, the latest match with any scan.
// ==============================================================================

import { STATIONS, orderedKeys, compareMatchKeys, matchLabel } from '../shared/schedule.js';

export function coverage(schedule, records, { playedThrough = null } = {}) {
  const keys = orderedKeys(schedule);
  const byMatch = {};
  for (const r of records) (byMatch[r.match_key] ||= []).push(r);

  let last = playedThrough && schedule[playedThrough] ? playedThrough : null;
  if (!last) {
    const scanned = keys.filter(k => byMatch[k]);
    last = scanned.length ? scanned[scanned.length - 1] : null;
  }

  const rows = [];
  const missing = [];
  let ok = 0;
  for (const key of keys) {
    if (!last || compareMatchKeys(key, last) > 0) break;
    const cells = STATIONS.map((station, i) => {
      const expected = schedule[key][i];
      const recs = (byMatch[key] || []).filter(r => r.station === station);
      let status = 'ok';
      if (!recs.length) status = 'missing';
      else if (recs.some(r => r.team !== expected)) status = 'mismatch';
      else if (new Set(recs.map(r => r.scout_id)).size > 1) status = 'multi';
      if (status === 'missing') missing.push({ key, label: matchLabel(key), station, team: expected });
      else ok++;
      return { station, expected, status, records: recs.map(r => ({ team: r.team, scout_id: r.scout_id })) };
    });
    rows.push({ key, label: matchLabel(key), cells });
  }

  // Records for matches the schedule doesn't have (e.g. added by hand on an iPad).
  const extras = records.filter(r => !schedule[r.match_key])
    .map(r => ({ key: r.match_key, label: matchLabel(r.match_key), station: r.station, team: r.team, scout_id: r.scout_id }));

  return {
    playedThrough: last,
    auto: !(playedThrough && schedule[playedThrough]),
    rows,
    missing,
    extras,
    totals: { slots: rows.length * STATIONS.length, scanned: ok, missing: missing.length },
  };
}
