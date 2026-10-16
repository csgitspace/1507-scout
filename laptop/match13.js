// ==============================================================================
// match13 (www.match13.com): outside REFERENCE data, like Statbotics, fetched
// over the tethered phone. Never scouting data.
//
//   event teams   each team's xP (match13's points-per-match rating) with
//                 auto / teleop / endgame parts, its spread, and match13's
//                 copy of Statbotics EPA
//   matches       each match's forecast: red win chance, predicted scores
//   sim           projected final rank per team (only while the event is live)
//   season        every team's season rating, for the dashboard's Lookup screen
//
// API docs: https://www.match13.com/docs/api (OpenAPI "match13 read API" 1.0.0).
// Every request needs `Authorization: Bearer m13_live_...` (key made on the
// match13 account page; stored on the laptop only). Allowance per account:
// 60/min, 1000/hour, 30000/week. The API sends no CORS headers, so only a
// server (this laptop) can call it.
// ==============================================================================

import { shortMatchKey } from '../shared/schedule.js';

export const M13_BASE = 'https://actions.match13.com';
const TIMEOUT_MS = 20000;
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round1 = (x) => (x === null ? null : Math.round(x * 10) / 10);
const round2 = (x) => (x === null ? null : Math.round(x * 100) / 100);

/** GET one route. Returns the JSON, or null for 404 (nothing there yet). Errors say what to do. */
export async function m13Get(path, key, fetchImpl = fetch) {
  let res;
  try {
    res = await fetchImpl(M13_BASE + path, {
      headers: { Authorization: `Bearer ${key}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err.name === 'TimeoutError') throw new Error('match13 took too long to answer');
    throw new Error(`Can't reach match13 — is the phone tethered? (${err.message})`);
  }
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('match13 key not accepted — make a new key on your match13 account page and enter it on Event setup');
  if (res.status === 429) {
    const wait = Number(res.headers?.get?.('retry-after')) || null;
    throw new Error(`match13 rate limit reached${wait ? ` — wait ${wait} s` : ''}`);
  }
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).detail || ''; } catch { /* not problem+json */ }
    throw new Error(`match13 error ${res.status}${detail ? `: ${detail}` : res.status >= 500 ? ' (their site is having trouble)' : ''}`);
  }
  return res.json();
}

/** Spread (standard deviation) from match13's variance. */
const spread = (v) => (num(v) !== null && v >= 0 ? round1(Math.sqrt(v)) : null);

/** /v1/events/{event}/teams -> [{ team, xp, auto, tele, end, sd, rp1, rp2, rp3, epa }] */
export function parseM13EventTeams(json) {
  return ((json && json.teams) || []).map(t => ({
    team: Number(t.teamNumber),
    // xpEnd = rating after its latest match here (equals xpStart before it plays).
    xp: round1(num(t.xpEnd) ?? num(t.xpStart)),
    auto: round1(num(t.xAuto)), tele: round1(num(t.xTele)), end: round1(num(t.xEnd)),
    sd: spread(t.xVar),
    rp1: round2(num(t.xRp1)), rp2: round2(num(t.xRp2)), rp3: round2(num(t.xRp3)),
    epa: round1(num(t.epa)),
  })).filter(r => r.team >= 1 && r.xp !== null);
}

/** /v1/events/{event}/matches -> [{ key, redWin, redScore, blueScore }] (forecasts; played matches too). */
export function parseM13Matches(json) {
  return ((json && json.matches) || []).map(m => {
    const p = m.pred || {};
    return { key: shortMatchKey(m.key), redWin: round2(num(p.winProb)), redScore: round1(num(p.redScore)), blueScore: round1(num(p.blueScore)) };
  }).filter(m => m.key && m.redWin !== null);
}

/** /v1/events/{event}/sim -> { team: { rank, lo, hi, rps } } (median rank with its 5th–95th percentile). */
export function parseM13Sim(json) {
  const out = {};
  for (const t of (json && json.teams) || []) {
    if (!(t.teamNumber >= 1) || num(t.p50) === null) continue;
    out[t.teamNumber] = { rank: Math.round(t.p50), lo: Math.round(num(t.p5) ?? t.p50), hi: Math.round(num(t.p95) ?? t.p50), rps: round1(num(t.meanRps)) };
  }
  return out;
}

/** One /v1/years/{year}/teams row -> our season row. */
export function parseM13SeasonRow(t) {
  if (!t || !(t.teamNumber >= 1) || num(t.xp) === null) return null;
  return {
    team: Number(t.teamNumber), xp: round1(t.xp), auto: round1(num(t.xAuto)), tele: round1(num(t.xTele)), end: round1(num(t.xEnd)),
    sd: spread(t.xVar), rank: num(t.rank), pct: round1(num(t.percentile)), epa: round1(num(t.epa)), opr: round1(num(t.opr)),
  };
}

/** Everything for one event. The parts fail separately: a sim or schedule that doesn't exist yet isn't an error. */
export async function fetchM13Event(event, key, fetchImpl = fetch) {
  const e = encodeURIComponent(event);
  const [teams, matches, sim] = await Promise.allSettled([
    m13Get(`/v1/events/${e}/teams`, key, fetchImpl),
    m13Get(`/v1/events/${e}/matches`, key, fetchImpl),
    m13Get(`/v1/events/${e}/sim`, key, fetchImpl),
  ]);
  if (teams.status === 'rejected') throw teams.reason;
  if (teams.value === null) throw new Error(`match13 doesn't have ${event} (yet)`);
  return {
    teams: parseM13EventTeams(teams.value),
    forecasts: matches.status === 'fulfilled' ? parseM13Matches(matches.value) : [],
    sim: sim.status === 'fulfilled' && sim.value ? parseM13Sim(sim.value) : {},
  };
}

/** Every team's season rating (all pages; offseason play included). */
export async function fetchM13Season(year, key, fetchImpl = fetch) {
  const rows = [];
  for (let page = 1; page && page <= 20; ) {
    const json = await m13Get(`/v1/years/${year}/teams?scope=all&limit=1000&page=${page}`, key, fetchImpl);
    if (!json) break;
    for (const t of json.teams || []) { const r = parseM13SeasonRow(t); if (r) rows.push(r); }
    page = json.nextPage || null;
  }
  return rows.sort((a, b) => a.team - b.team);
}
