// ==============================================================================
// Event intel: outside REFERENCE data, fetched over the tethered phone.
//
//   - The Blue Alliance: match results, rankings and OPRs (every sync cycle)
//   - Statbotics: each team's EPA (every 30 minutes, or when the team list
//     changes). Event EPA when Statbotics tracks the event, else the team's
//     season EPA.
//
//   - match13 (laptop/match13.js): xP ratings, match forecasts and projected
//     ranks for the event (every 5 minutes), and every team's season rating
//     for the dashboard's Lookup screen (every 6 hours). Needs a match13 key.
//
// This is never scouting data: it's kept in settings (`tbaIntel:<event>`,
// `sbIntel:<event>`, `m13Intel:<event>`, `m13Season:<year>`), not in `records`, and the dashboard shows it beside
// scouted stats rather than mixing it in. Every fetch is optional: if a site
// is down or doesn't know the event, the last good data is kept and the
// station shows why.
//
// Statbotics v3 field names come from its source code
// (github.com/avgupta456/statbotics: backend/src/breakdown.py, team_event.py,
// team_year.py): epa.total_points is a number, and epa.breakdown has
// auto_points, teleop_points, endgame_points, plus 2026's total_fuel and
// total_tower.
// ==============================================================================

import { createHash } from 'node:crypto';
import { tbaGet } from './tba.js';
import { fetchM13Event, fetchM13Season } from './match13.js';
import { shortMatchKey, compareMatchKeys } from '../shared/schedule.js';

const STATBOTICS = 'https://api.statbotics.io/v3';
const STATBOTICS_EVERY_MS = 30 * 60 * 1000;
const M13_EVENT_EVERY_MS = 5 * 60 * 1000;       // ~36 requests/hour; match13 allows 1000
const M13_SEASON_EVERY_MS = 6 * 60 * 60 * 1000;
const TIMEOUT_MS = 20000;

const teamNumber = (k) => parseInt(String(k).replace(/^frc/, ''), 10);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);

// ---------------------------------------------------------------------------
// The Blue Alliance
// ---------------------------------------------------------------------------

/** TBA /matches/simple -> played matches only: [{ key, red, blue, redScore, blueScore, winner, time }] */
export function parseTbaResults(matches) {
  const out = [];
  for (const m of matches || []) {
    const key = shortMatchKey(m.key);
    const red = m.alliances?.red, blue = m.alliances?.blue;
    if (!key || !red || !blue) continue;
    // TBA uses -1 (or null) for a match that hasn't been played yet.
    if (!(red.score >= 0 && blue.score >= 0)) continue;
    out.push({
      key,
      red: (red.team_keys || []).map(teamNumber),
      blue: (blue.team_keys || []).map(teamNumber),
      redScore: red.score,
      blueScore: blue.score,
      winner: m.winning_alliance || (red.score === blue.score ? 'tie' : ''),
      time: m.actual_time || null,
    });
  }
  return out;
}

/** TBA /rankings -> [{ team, rank, wins, losses, ties, played, rpAvg }] (first sort order = ranking score). */
export function parseTbaRankings(data) {
  return ((data && data.rankings) || []).map(r => ({
    team: teamNumber(r.team_key),
    rank: r.rank,
    wins: r.record?.wins ?? null,
    losses: r.record?.losses ?? null,
    ties: r.record?.ties ?? null,
    played: r.matches_played ?? null,
    rpAvg: Array.isArray(r.sort_orders) && num(r.sort_orders[0]) !== null ? Math.round(r.sort_orders[0] * 100) / 100 : null,
  })).filter(r => r.team >= 1);
}

/** TBA /oprs -> { team: opr } */
export function parseTbaOprs(data) {
  const out = {};
  for (const [k, v] of Object.entries((data && data.oprs) || {})) {
    if (num(v) !== null) out[teamNumber(k)] = round1(v);
  }
  return out;
}

/**
 * Results, rankings and OPRs. Each part can fail on its own (an offseason
 * event may have no rankings, or TBA may not have computed OPRs yet).
 */
export async function fetchTbaIntel(event, apiKey, fetchImpl = fetch) {
  const [matches, rankings, oprs] = await Promise.allSettled([
    tbaGet(`/event/${event}/matches/simple`, apiKey, fetchImpl),
    tbaGet(`/event/${event}/rankings`, apiKey, fetchImpl),
    tbaGet(`/event/${event}/oprs`, apiKey, fetchImpl),
  ]);
  if (matches.status === 'rejected') throw matches.reason;   // the main part: no point keeping the others
  return {
    results: parseTbaResults(matches.value),
    rankings: rankings.status === 'fulfilled' ? parseTbaRankings(rankings.value) : [],
    oprs: oprs.status === 'fulfilled' ? parseTbaOprs(oprs.value) : {},
  };
}

// ---------------------------------------------------------------------------
// Statbotics
// ---------------------------------------------------------------------------

async function sbGet(path, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(STATBOTICS + path, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('Statbotics took too long to answer');
    throw new Error(`Can't reach Statbotics — is the phone tethered? (${err.message})`);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Statbotics error ${res.status}${res.status >= 500 ? ' (their site is having trouble)' : ''}`);
  return res.json();
}

/** One Statbotics team_event or team_year object -> our row. */
export function parseStatboticsTeam(obj, source) {
  const epa = obj && obj.epa;
  const bd = (epa && epa.breakdown) || {};
  const total = num(epa && epa.total_points) ?? num(epa && epa.total_points && epa.total_points.mean) ?? num(bd.total_points);
  if (!obj || !(obj.team >= 1) || total === null) return null;
  return {
    team: Number(obj.team),
    epa: round1(total),
    auto: round1(num(bd.auto_points)),
    teleop: round1(num(bd.teleop_points)),
    endgame: round1(num(bd.endgame_points)),
    fuel: round1(num(bd.total_fuel)),
    tower: round1(num(bd.total_tower)),
    source,
  };
}

/** Runs fn over items, `limit` at a time. Results keep the input order. */
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]).then(v => ({ ok: true, v }), e => ({ ok: false, e }));
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

/**
 * EPA for every team at the event: event EPA where Statbotics tracks the
 * event, season EPA (team_year) for the rest.
 * Returns { teams: [...], source: 'event' | 'season' | 'mixed', missing: [team] }.
 */
export async function fetchStatbotics(event, teams, fetchImpl = fetch) {
  const year = Number(String(event).slice(0, 4));
  const byTeam = {};
  let eventError = null;
  try {
    const list = await sbGet(`/team_events?event=${encodeURIComponent(event)}&limit=200`, fetchImpl);
    for (const o of list || []) {
      const row = parseStatboticsTeam(o, 'event');
      if (row) byTeam[row.team] = row;
    }
  } catch (err) {
    eventError = err;   // still try the per-team season EPA below
  }

  const rest = teams.filter(t => !byTeam[t]);
  const got = await pool(rest, 6, (t) => sbGet(`/team_year/${t}/${year}`, fetchImpl));
  let firstError = null;
  rest.forEach((t, i) => {
    if (got[i].ok) {
      const row = parseStatboticsTeam(got[i].v, 'season');
      if (row) byTeam[t] = row;
    } else firstError ||= got[i].e;
  });

  const rows = Object.values(byTeam).sort((a, b) => a.team - b.team);
  if (!rows.length && (firstError || eventError)) throw firstError || eventError;
  const sources = new Set(rows.map(r => r.source));
  return {
    teams: rows,
    source: sources.size > 1 ? 'mixed' : (rows[0] && rows[0].source) || 'none',
    missing: teams.filter(t => !byTeam[t]),
  };
}

// ---------------------------------------------------------------------------
// Scheduler + storage
// ---------------------------------------------------------------------------

/** Every team the station knows about for the event: TBA team list, plus anyone in the schedule. */
export function eventTeams(store, event) {
  const set = new Set(store.teams(event).map(t => t.team));
  for (const teams of Object.values(store.schedule(event))) for (const t of teams) if (t >= 1) set.add(t);
  return [...set].sort((a, b) => a - b);
}

/**
 * What the dashboard gets: one row per team (EPA, OPR, rank) and one per
 * played match. Pure function of what's stored.
 */
export function externalFor(store, event) {
  const tba = store.getSetting(`tbaIntel:${event}`) || {};
  const sb = store.getSetting(`sbIntel:${event}`) || {};
  const m13 = store.getSetting(`m13Intel:${event}`) || {};
  const epa = Object.fromEntries((sb.teams || []).map(r => [r.team, r]));
  const xp = Object.fromEntries((m13.teams || []).map(r => [r.team, r]));
  const sim = m13.sim || {};
  const rank = Object.fromEntries((tba.rankings || []).map(r => [r.team, r]));
  const oprs = tba.oprs || {};
  const teams = new Set([...Object.keys(epa), ...Object.keys(xp), ...Object.keys(rank), ...Object.keys(oprs)].map(Number));
  const external = [...teams].sort((a, b) => a - b).map(team => {
    const r = rank[team] || {}, x = xp[team] || {}, s = sim[team] || {};
    // Statbotics first; if it has nothing for this team, match13's copy of the EPA (no breakdown).
    const e = epa[team] || (x.epa !== null && x.epa !== undefined ? { epa: x.epa, source: 'match13' } : {});
    return {
      team,
      epa: e.epa ?? '', epa_auto: e.auto ?? '', epa_teleop: e.teleop ?? '', epa_endgame: e.endgame ?? '',
      epa_fuel: e.fuel ?? '', epa_tower: e.tower ?? '', epa_source: e.source || '',
      opr: oprs[team] ?? '',
      // En dashes: Sheets would turn "8-2-1" into a date.
      rank: r.rank ?? '', record: r.wins === undefined || r.wins === null ? '' : `${r.wins}–${r.losses}–${r.ties}`,
      rp_avg: r.rpAvg ?? '',
      xp: x.xp ?? '', xp_auto: x.auto ?? '', xp_tele: x.tele ?? '', xp_end: x.end ?? '', xp_sd: x.sd ?? '',
      sim_rank: s.rank ?? '', sim_lo: s.lo ?? '', sim_hi: s.hi ?? '',
    };
  });
  return {
    external,
    results: tba.results || [],
    forecasts: m13.forecasts || [],
    fetched: { tba: tba.fetchedAt || null, statbotics: sb.fetchedAt || null, match13: m13.fetchedAt || null },
  };
}

/** Short fingerprint so the sync only sends intel when it changed. */
export function intelSignature(intel) {
  return createHash('sha1').update(JSON.stringify([intel.external, intel.results, intel.forecasts || []])).digest('hex').slice(0, 16);
}

/** match13 season ratings for the event's year (for Lookup), or null. Sent only when its fingerprint changes. */
export function seasonFor(store, event) {
  const year = Number(String(event || '').slice(0, 4));
  const s = year ? store.getSetting(`m13Season:${year}`) : null;
  if (!s || !s.teams || !s.teams.length) return null;
  return { year, fetchedAt: s.fetchedAt, teams: s.teams,
    sig: createHash('sha1').update(JSON.stringify(s.teams)).digest('hex').slice(0, 16) };
}

/** Latest match in `schedule` that TBA has a result for, or null. */
export function latestPlayed(store, event) {
  const tba = store.getSetting(`tbaIntel:${event}`);
  const schedule = store.schedule(event);
  const played = ((tba && tba.results) || []).map(r => r.key).filter(k => schedule[k]);
  if (!played.length) return null;
  return played.sort(compareMatchKeys)[played.length - 1];
}

export function createIntel({ store, fetchImpl = fetch, now = () => Date.now(), statboticsEveryMs = STATBOTICS_EVERY_MS,
  m13EventEveryMs = M13_EVENT_EVERY_MS, m13SeasonEveryMs = M13_SEASON_EVERY_MS }) {
  const status = {
    tba: { lastAttempt: null, lastSuccess: null, lastError: null, results: 0, running: false },
    statbotics: { lastAttempt: null, lastSuccess: null, lastError: null, teams: 0, source: null, missing: [], running: false },
    match13: { lastAttempt: null, lastSuccess: null, lastError: null, running: false },
    season: { lastAttempt: null, lastSuccess: null, lastError: null, year: null, running: false },
  };
  let sbTeamsSig = null;

  const tbaKey = () => process.env.TBA_KEY || store.getSetting('tbaKey');
  const m13Key = () => process.env.M13_KEY || store.getSetting('m13Key');

  /** Runs a fetch with the shared bookkeeping: skip if already running, record success / error. */
  async function track(s, fn) {
    if (s.running) return;
    s.running = true;
    s.lastAttempt = now();
    try {
      await fn();
      s.lastSuccess = now();
      s.lastError = null;
    } catch (err) {
      s.lastError = err.message;
    } finally {
      s.running = false;
    }
  }

  async function refreshMatch13() {
    const event = store.getSetting('event');
    const s = status.match13;
    if (!event) { s.lastError = 'Set the event on Event setup first'; return; }
    if (!m13Key()) { s.lastError = 'No match13 key — enter it on Event setup (optional)'; return; }
    await track(s, async () => {
      const data = await fetchM13Event(event, m13Key(), fetchImpl);
      store.setSetting(`m13Intel:${event}`, { ...data, fetchedAt: now() });
    });
  }

  async function refreshSeason() {
    const event = store.getSetting('event');
    const s = status.season;
    const year = Number(String(event || '').slice(0, 4));
    if (!year) { s.lastError = 'Set the event on Event setup first'; return; }
    if (!m13Key()) { s.lastError = 'No match13 key — enter it on Event setup (optional)'; return; }
    s.year = year;
    await track(s, async () => {
      const teams = await fetchM13Season(year, m13Key(), fetchImpl);
      if (!teams.length) throw new Error(`match13 has no ${year} season ratings yet`);
      store.setSetting(`m13Season:${year}`, { teams, fetchedAt: now() });
    });
  }

  async function refreshTba() {
    const event = store.getSetting('event');
    const s = status.tba;
    if (!event) { s.lastError = 'Set the event on Event setup first'; return; }
    if (!tbaKey()) { s.lastError = 'No TBA read key — enter it on Event setup'; return; }
    if (s.running) return;
    s.running = true;
    s.lastAttempt = now();
    try {
      const data = await fetchTbaIntel(event, tbaKey(), fetchImpl);
      store.setSetting(`tbaIntel:${event}`, { ...data, fetchedAt: now() });
      s.lastSuccess = now();
      s.lastError = null;
      s.results = data.results.length;
    } catch (err) {
      s.lastError = err.message;
    } finally {
      s.running = false;
    }
  }

  async function refreshStatbotics() {
    const event = store.getSetting('event');
    const s = status.statbotics;
    if (!event) { s.lastError = 'Set the event on Event setup first'; return; }
    const teams = eventTeams(store, event);
    if (!teams.length) { s.lastError = 'No teams yet — import the event from TBA or load a schedule'; return; }
    if (s.running) return;
    s.running = true;
    s.lastAttempt = now();
    sbTeamsSig = `${event}:${teams.join(',')}`;
    try {
      const data = await fetchStatbotics(event, teams, fetchImpl);
      store.setSetting(`sbIntel:${event}`, { ...data, fetchedAt: now() });
      s.lastSuccess = now();
      s.lastError = data.missing.length ? `No EPA for ${data.missing.length} team${data.missing.length === 1 ? '' : 's'}: ${data.missing.join(', ')}` : null;
      s.teams = data.teams.length;
      s.source = data.source;
      s.missing = data.missing;
    } catch (err) {
      s.lastError = err.message;
    } finally {
      s.running = false;
    }
  }

  /** Called every sync cycle: TBA always; Statbotics and match13 when stale (or the team list / year changed). */
  async function refreshDue() {
    const event = store.getSetting('event');
    const teamsSig = event ? `${event}:${eventTeams(store, event).join(',')}` : null;
    const stale = (s, every) => s.lastAttempt === null || now() - s.lastAttempt >= every;
    const sbStale = stale(status.statbotics, statboticsEveryMs) || teamsSig !== sbTeamsSig;
    const year = Number(String(event || '').slice(0, 4));
    const seasonStale = stale(status.season, m13SeasonEveryMs) || (year && status.season.year !== year);
    await Promise.all([
      refreshTba(),
      sbStale ? refreshStatbotics() : null,
      m13Key() && stale(status.match13, m13EventEveryMs) ? refreshMatch13() : null,
      m13Key() && seasonStale ? refreshSeason() : null,
    ]);
  }

  async function refreshAll() {
    await Promise.all([refreshTba(), refreshStatbotics(), refreshMatch13(), refreshSeason()]);
    return getStatus();
  }

  function getStatus() {
    const event = store.getSetting('event');
    const stored = (k) => (event ? store.getSetting(`${k}:${event}`) : null);
    const tba = stored('tbaIntel'), sb = stored('sbIntel'), m13 = stored('m13Intel');
    const year = Number(String(event || '').slice(0, 4));
    const season = year ? store.getSetting(`m13Season:${year}`) : null;
    return {
      hasTbaKey: !!tbaKey(),
      hasM13Key: !!m13Key(),
      tba: { ...status.tba, fetchedAt: tba ? tba.fetchedAt : null, results: tba ? tba.results.length : 0,
        rankings: tba ? tba.rankings.length : 0, oprs: tba ? Object.keys(tba.oprs).length : 0 },
      statbotics: { ...status.statbotics, fetchedAt: sb ? sb.fetchedAt : null, teams: sb ? sb.teams.length : 0,
        source: sb ? sb.source : null },
      match13: { ...status.match13, fetchedAt: m13 ? m13.fetchedAt : null, teams: m13 ? m13.teams.length : 0,
        forecasts: m13 ? m13.forecasts.length : 0, simmed: m13 ? Object.keys(m13.sim || {}).length : 0,
        seasonTeams: season ? season.teams.length : 0, seasonFetchedAt: season ? season.fetchedAt : null,
        seasonError: status.season.lastError },
    };
  }

  return { refreshTba, refreshStatbotics, refreshMatch13, refreshSeason, refreshDue, refreshAll, getStatus };
}
