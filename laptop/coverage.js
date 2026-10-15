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
// actually been played; by default, the later of the latest match with any
// scan and the latest match The Blue Alliance has a result for
// (`resultsThrough`), so a match nobody scanned still counts as missing.
// ==============================================================================

import { STATIONS, orderedKeys, compareMatchKeys, matchLabel } from '../shared/schedule.js';

export function coverage(schedule, records, { playedThrough = null, resultsThrough = null } = {}) {
  const keys = orderedKeys(schedule);
  const byMatch = {};
  for (const r of records) (byMatch[r.match_key] ||= []).push(r);

  let last = playedThrough && schedule[playedThrough] ? playedThrough : null;
  if (!last) {
    const scanned = keys.filter(k => byMatch[k]);
    last = scanned.length ? scanned[scanned.length - 1] : null;
    if (resultsThrough && schedule[resultsThrough] && (!last || compareMatchKeys(resultsThrough, last) > 0)) last = resultsThrough;
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

/**
 * The Data health screen's payload, sent with every sync: the laptop's own
 * coverage (it's the source of truth), plus app versions and records per
 * scout. Kept small: no full grid, just the problems.
 */
export function health(schedule, records, { playedThrough = null, resultsThrough = null, roster = [], pending = 0, now = Date.now() } = {}) {
  const cov = coverage(schedule, records, { playedThrough, resultsThrough });
  const names = Object.fromEntries(roster.map(s => [s.id, s.name]));
  const problems = (status) => cov.rows.flatMap(row => row.cells.filter(c => c.status === status).map(c => ({
    key: row.key, label: row.label, station: c.station, expected: c.expected,
    found: c.records.map(r => ({ team: r.team, scout: names[r.scout_id] || r.scout_id })),
  })));
  const versions = {}, perScout = {};
  for (const r of records) {
    versions[r.app_version || '?'] = (versions[r.app_version || '?'] || 0) + 1;
    const who = names[r.scout_id] || r.scout_id;
    perScout[who] = (perScout[who] || 0) + 1;
  }
  // Lists keep only the newest problems: the payload lands in one Sheets cell (50,000-character limit).
  const mismatches = problems('mismatch'), multi = problems('multi');
  return {
    at: now,
    playedThrough: cov.playedThrough,
    playedThroughLabel: cov.playedThrough ? matchLabel(cov.playedThrough) : null,
    totals: { ...cov.totals, mismatches: mismatches.length, multi: multi.length, extras: cov.extras.length },
    missing: cov.missing.slice(-120),
    mismatches: mismatches.slice(-40),
    multi: multi.slice(-40),
    extras: cov.extras.slice(-40).map(e => ({ ...e, scout: names[e.scout_id] || e.scout_id })),
    versions,
    perScout: Object.entries(perScout).map(([scout, n]) => ({ scout, records: n }))
      .sort((a, b) => b.records - a.records || a.scout.localeCompare(b.scout)),
    records: records.length,
    pending,
    scheduleMatches: Object.keys(schedule).length,
  };
}
