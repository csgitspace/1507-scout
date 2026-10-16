import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../laptop/db.js';
import { ingest } from '../laptop/intake.js';
import { createSync } from '../laptop/sync.js';
import { coverage, health } from '../laptop/coverage.js';
import {
  parseTbaResults, parseTbaRankings, parseTbaOprs, parseStatboticsTeam, fetchStatbotics, createIntel,
  externalFor, latestPlayed, eventTeams,
} from '../laptop/intel.js';
import { encodeRecord } from '../shared/codec.js';
import { emptyValues } from '../shared/fields.js';
import { FakeSpreadsheet, loadProject, plain } from './helpers/fake-apps-script.js';

const EVENT = '2026test';

// ---------- fixtures shaped like the real APIs ----------
const tbaMatch = (key, red, blue, redScore, blueScore, winner = '') => ({
  key: `${EVENT}_${key}`, comp_level: key.replace(/\d.*/, ''), winning_alliance: winner, actual_time: redScore >= 0 ? 1792000000 : null,
  alliances: { red: { team_keys: red.map(t => `frc${t}`), score: redScore }, blue: { team_keys: blue.map(t => `frc${t}`), score: blueScore } },
});
const TBA_MATCHES = [
  tbaMatch('qm1', [1507, 2, 3], [4, 5, 6], 120, 98, 'red'),
  tbaMatch('qm2', [7, 8, 9], [10, 11, 12], 80, 80, ''),
  tbaMatch('qm3', [1, 2, 3], [4, 5, 6], -1, -1),          // not played yet
];
const TBA_RANKINGS = { rankings: [
  { rank: 1, team_key: 'frc1507', record: { wins: 2, losses: 0, ties: 0 }, matches_played: 2, sort_orders: [3.5, 120, 40] },
  { rank: 2, team_key: 'frc254', record: { wins: 1, losses: 1, ties: 0 }, matches_played: 2, sort_orders: [2.25, 100] },
], sort_order_info: [{ name: 'Ranking Score', precision: 2 }] };
const TBA_OPRS = { oprs: { frc1507: 41.234, frc254: 55.06 }, dprs: {}, ccwms: {} };

/** A Statbotics v3 team_event / team_year object (shape from backend/src/db/models/team_event.py). */
const sbTeam = (team, epa, extra = {}) => ({
  team, year: 2026, event: EVENT, team_name: `Team ${team}`,
  epa: { total_points: epa, unitless: 1600, norm: 1600,
    breakdown: { total_points: epa, auto_points: 10, teleop_points: epa - 20, endgame_points: 10, total_fuel: 30, total_tower: 12 },
    stats: { start: epa, pre_elim: epa, mean: epa, max: epa } },
  record: {}, ...extra,
});

/** fetch stand-in routing by URL. routes: [[regex, handler(url) -> object | {status} | Error]] */
function routedFetch(routes) {
  const calls = [];
  const fn = async (url) => {
    calls.push(url);
    for (const [re, handler] of routes) {
      if (!re.test(url)) continue;
      const out = await handler(url);
      if (out instanceof Error) throw out;
      if (out && out.__status) return { ok: false, status: out.__status, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => out };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  fn.calls = calls;
  return fn;
}

function station() {
  const store = openDb(':memory:');
  store.setSetting('event', EVENT);
  store.setSetting('tbaKey', 'tba-key');
  store.setSetting('roster', [{ id: 'ada', name: 'Ada' }, { id: 'ben', name: 'Ben' }]);
  store.replaceSchedule(EVENT, [
    { key: 'qm1', teams: [1507, 2, 3, 4, 5, 6] },
    { key: 'qm2', teams: [7, 8, 9, 10, 11, 12] },
    { key: 'qm3', teams: [1, 2, 3, 1507, 5, 6] },
  ]);
  store.replaceTeams(EVENT, [{ team: 1507, name: 'Warlocks' }, { team: 254, name: 'Cheesy Poofs' }]);
  return store;
}

function scan(store, { match = 'qm1', team = 1507, station: st = 'R1', scout = 'ada', ts = 1790000000, app = '1.0.1', values = {} } = {}) {
  return ingest(store, encodeRecord({ app_version: app, event: EVENT, match_key: match, team, scout_id: scout, station: st, ts,
    values: { ...emptyValues(), auto_start_position: 0, endgame_level: 0, primary_role: 0, cycle_speed: 3, ...values } }));
}

// ---------- parsing ----------
test('TBA: only played matches become results; rankings and OPRs parse', () => {
  const results = parseTbaResults(TBA_MATCHES);
  assert.deepEqual(results.map(r => r.key), ['qm1', 'qm2'], 'qm3 (score -1) is not a result');
  assert.deepEqual(results[0], { key: 'qm1', red: [1507, 2, 3], blue: [4, 5, 6], redScore: 120, blueScore: 98, winner: 'red', time: 1792000000 });
  assert.equal(results[1].winner, 'tie');
  assert.deepEqual(parseTbaRankings(TBA_RANKINGS)[0], { team: 1507, rank: 1, wins: 2, losses: 0, ties: 0, played: 2, rpAvg: 3.5 });
  assert.deepEqual(parseTbaRankings(null), [], 'offseason events may have no rankings');
  assert.deepEqual(parseTbaOprs(TBA_OPRS), { 1507: 41.2, 254: 55.1 });
});

test('Statbotics: reads EPA and the 2026 breakdown; ignores objects without an EPA', () => {
  assert.deepEqual(parseStatboticsTeam(sbTeam(1507, 52.34), 'event'),
    { team: 1507, epa: 52.3, auto: 10, teleop: 32.3, endgame: 10, fuel: 30, tower: 12, source: 'event' });
  assert.equal(parseStatboticsTeam({ team: 5, epa: { total_points: null } }, 'season'), null);
  assert.equal(parseStatboticsTeam(null, 'season'), null);
});

test('Statbotics: event EPA when the event is tracked, season EPA for everyone else, missing teams listed', async () => {
  const fetchImpl = routedFetch([
    [/team_events\?event=/, () => [sbTeam(1507, 50)]],
    [/team_year\/254\/2026/, () => sbTeam(254, 70)],
    [/team_year\/9999\/2026/, () => ({ __status: 404 })],
  ]);
  const out = await fetchStatbotics(EVENT, [254, 1507, 9999], fetchImpl);
  assert.deepEqual(out.teams.map(t => [t.team, t.epa, t.source]), [[254, 70, 'season'], [1507, 50, 'event']]);
  assert.equal(out.source, 'mixed');
  assert.deepEqual(out.missing, [9999]);
  assert.ok(!fetchImpl.calls.some(u => u.includes('team_year/1507')), "no per-team call for a team the event list covered");
});

test('Statbotics down: a clear error, and an untracked event falls back to season EPA', async () => {
  const down = routedFetch([[/./, () => ({ __status: 500 })]]);
  await assert.rejects(fetchStatbotics(EVENT, [254], down), /Statbotics error 500/);
  const untracked = routedFetch([[/team_events/, () => []], [/team_year\/254/, () => sbTeam(254, 70)]]);
  const out = await fetchStatbotics(EVENT, [254], untracked);
  assert.equal(out.source, 'season');
});

// ---------- scheduler + storage ----------
test('intel: fetches both, keeps the last good data when a site goes down, explains a missing key', async () => {
  const store = station();
  let tbaUp = true, sbUp = true;
  const fetchImpl = async (url, opts) => {
    if (url.includes('thebluealliance')) {
      if (!tbaUp) throw new TypeError('fetch failed');
      const body = url.endsWith('/matches/simple') ? TBA_MATCHES : url.endsWith('/rankings') ? TBA_RANKINGS : TBA_OPRS;
      assert.equal(opts.headers['X-TBA-Auth-Key'], 'tba-key');
      return { ok: true, status: 200, json: async () => body };
    }
    if (!sbUp) return { ok: false, status: 500, json: async () => ({}) };
    if (url.includes('team_events')) return { ok: true, status: 200, json: async () => [] };
    const team = Number(/team_year\/(\d+)/.exec(url)[1]);
    return { ok: true, status: 200, json: async () => sbTeam(team, team === 1507 ? 50 : 30) };
  };
  const intel = createIntel({ store, fetchImpl });
  let st = await intel.refreshAll();
  assert.equal(st.tba.lastError, null);
  assert.equal(st.tba.results, 2);
  assert.equal(st.tba.oprs, 2);
  assert.equal(st.statbotics.lastError, null);
  assert.equal(st.statbotics.teams, eventTeams(store, EVENT).length, 'every team in the team list and schedule');
  assert.equal(st.statbotics.source, 'season');

  tbaUp = false; sbUp = false;
  st = await intel.refreshAll();
  assert.match(st.tba.lastError, /phone tethered/);
  assert.match(st.statbotics.lastError, /Statbotics error 500/);
  assert.equal(st.tba.results, 2, 'last good TBA data kept');
  assert.equal(externalFor(store, EVENT).external.find(e => e.team === 1507).epa, 50, 'last good EPA kept');

  store.setSetting('tbaKey', null);
  const noKey = createIntel({ store, fetchImpl });
  await noKey.refreshTba();
  assert.match(noKey.getStatus().tba.lastError, /No TBA read key/);
});

test('intel: Statbotics is only re-fetched when stale or when the team list changes', async () => {
  const store = station();
  let t = 0;
  const fetchImpl = routedFetch([[/thebluealliance.*matches/, () => TBA_MATCHES], [/thebluealliance/, () => ({})],
    [/team_events/, () => []], [/team_year/, (u) => sbTeam(Number(/team_year\/(\d+)/.exec(u)[1]), 20)]]);
  const intel = createIntel({ store, fetchImpl, now: () => t, statboticsEveryMs: 1000 });
  await intel.refreshDue();
  const sbCalls = () => fetchImpl.calls.filter(u => u.includes('statbotics')).length;
  const first = sbCalls();
  t = 500; await intel.refreshDue();
  assert.equal(sbCalls(), first, 'not stale yet');
  store.replaceTeams(EVENT, [{ team: 1507, name: 'Warlocks' }, { team: 254, name: '' }, { team: 118, name: '' }]);
  await intel.refreshDue();
  assert.ok(sbCalls() > first, 'new team -> re-fetch');
  const second = sbCalls();
  t = 5000; await intel.refreshDue();
  assert.ok(sbCalls() > second, 'stale -> re-fetch');
});

test('externalFor merges EPA, OPR and rank per team; record uses en dashes so Sheets keeps it as text', () => {
  const store = station();
  store.setSetting(`tbaIntel:${EVENT}`, { results: parseTbaResults(TBA_MATCHES), rankings: parseTbaRankings(TBA_RANKINGS),
    oprs: parseTbaOprs(TBA_OPRS), fetchedAt: 111 });
  store.setSetting(`sbIntel:${EVENT}`, { teams: [parseStatboticsTeam(sbTeam(1507, 50), 'event')], fetchedAt: 222 });
  const x = externalFor(store, EVENT);
  const us = x.external.find(e => e.team === 1507);
  assert.equal(us.epa, 50);
  assert.equal(us.opr, 41.2);
  assert.equal(us.rank, 1);
  assert.equal(us.record, '2–0–0');
  assert.equal(x.external.find(e => e.team === 254).epa, '', 'no EPA -> blank, still has OPR');
  assert.deepEqual(x.fetched, { tba: 111, statbotics: 222, match13: null });
  assert.equal(latestPlayed(store, EVENT), 'qm2');
});

// ---------- coverage + health ----------
test('coverage: a match TBA says was played counts as missing even if nobody scanned it', () => {
  const store = station();
  scan(store, { match: 'qm1', team: 1507, station: 'R1' });
  const sched = store.schedule(EVENT), recs = store.currentRecords(EVENT);
  assert.equal(coverage(sched, recs).playedThrough, 'qm1');
  const cov = coverage(sched, recs, { resultsThrough: 'qm2' });
  assert.equal(cov.playedThrough, 'qm2');
  assert.equal(cov.totals.missing, 11);
  assert.equal(coverage(sched, recs, { playedThrough: 'qm1', resultsThrough: 'qm2' }).playedThrough, 'qm1', 'a lead\'s choice wins');
});

test('health: missing, mismatches, two-scout robots, versions and per-scout counts', () => {
  const store = station();
  scan(store, { match: 'qm1', team: 1507, station: 'R1', scout: 'ada' });
  scan(store, { match: 'qm1', team: 1507, station: 'R1', scout: 'ben', app: '1.0.0' });
  scan(store, { match: 'qm1', team: 99, station: 'R2', scout: 'ada' });                       // schedule says 2
  scan(store, { match: 'qm40', team: 7, station: 'B1', scout: 'ben' });                       // not in schedule
  const hh = health(store.schedule(EVENT), store.currentRecords(EVENT), { roster: store.getSetting('roster'), now: 5 });
  assert.equal(hh.playedThrough, 'qm1');
  assert.equal(hh.totals.missing, 4);
  assert.deepEqual(hh.mismatches.map(m => [m.station, m.expected, m.found[0].team]), [['R2', 2, 99]]);
  assert.deepEqual(hh.multi[0].found.map(f => f.scout).sort(), ['Ada', 'Ben']);
  assert.equal(hh.extras[0].scout, 'Ben');
  assert.deepEqual(hh.versions, { '1.0.1': 3, '1.0.0': 1 });
  assert.deepEqual(hh.perScout, [{ scout: 'Ada', records: 2 }, { scout: 'Ben', records: 2 }]);
  assert.ok(JSON.stringify(hh).length < 50000);
});

// ---------- sync ----------
test('sync: intel goes only when it changed; health goes every time', async () => {
  const store = station();
  store.setSetting('syncUrl', 'https://script.google.com/macros/s/FAKE/exec');
  store.setSetting('syncToken', 'secret-token');
  scan(store);
  let intel = { external: [{ team: 1507, epa: 50 }], results: [], fetched: { tba: 1, statbotics: 1 } };
  const bodies = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body);
    bodies.push(body);
    return { ok: true, status: 200, text: async () => JSON.stringify({ ok: true, accepted: body.records.map(r => r.id), added: body.records.length }) };
  };
  const sync = createSync({ store, fetchImpl, intelFor: () => intel, healthFor: () => ({ totals: { missing: 0 } }) });
  await sync.syncOnce();
  await sync.syncOnce();
  assert.ok(bodies[0].intel, 'first sync sends intel');
  assert.equal(bodies[1].intel, undefined, 'unchanged -> not resent');
  assert.equal(bodies[0].health.pending, 0, 'pending counts what is left after this push');
  assert.ok(bodies[1].health, 'health every time');
  intel = { ...intel, external: [{ team: 1507, epa: 55 }] };
  await sync.syncOnce();
  assert.equal(bodies[2].intel.external[0].epa, 55);
});

// ---------- dashboard ----------
function dashboard() {
  const ss = new FakeSpreadsheet();
  const sync = loadProject('sync-endpoint', ss);
  const post = (body) => JSON.parse(sync.doPost({ postData: { contents: JSON.stringify({ token: 'secret-token', event: EVENT, records: [], ...body }) } }).getContent());
  return { ss, post };
}

const SCHEDULE = [
  { key: 'qm1', teams: [1507, 254, 118, 4, 5, 6] },
  { key: 'qm2', teams: [7, 8, 9, 10, 11, 12] },
  { key: 'qm3', teams: [21, 22, 23, 1507, 254, 26] },
  { key: 'qm4', teams: [31, 1507, 33, 34, 35, 36] },
];
const INTEL = {
  external: [
    { team: 254, epa: 70, epa_auto: 15, epa_teleop: 45, epa_endgame: 10, epa_fuel: 40, epa_tower: 12, epa_source: 'season', opr: 60, rank: 3, record: '1–1–0', rp_avg: 2 },
    { team: 1507, epa: 50, epa_source: 'event', opr: 41.2, rank: 1, record: '2–0–0', rp_avg: 3.5 },
    { team: 4, epa: 20, epa_source: 'season' },
  ],
  results: [{ key: 'qm1', red: [1507, 254, 118], blue: [4, 5, 6], redScore: 120, blueScore: 98, winner: 'red', time: 1792000000 }],
  fetched: { tba: 1792000100000, statbotics: 1792000000000 },
};

test('endpoint: writes External and Results tabs and stores health; the sync never touches mentor tabs', () => {
  const { ss, post } = dashboard();
  const res = post({ intel: INTEL, health: { playedThrough: 'qm1', totals: { missing: 2 } }, schedule: SCHEDULE, teams: [{ team: 254, name: 'Cheesy Poofs' }] });
  assert.equal(res.ok, true);
  const ext = ss.getSheetByName('External').objects();
  assert.equal(ext.find(e => e.team === 254).epa, 70);
  assert.equal(ext.find(e => e.team === 254).record, '1–1–0');
  const results = ss.getSheetByName('Results').objects();
  assert.deepEqual([results[0].match_key, results[0].match, results[0].red1, results[0].red_score, results[0].winner], ['qm1', 'Qual 1', 1507, 120, 'red']);
  assert.ok(ss.getSheetByName('External').protections.length, 'External is protected');
  const cfg = Object.fromEntries(ss.getSheetByName('Config').objects().map(r => [r.key, JSON.parse(r.value)]));
  assert.equal(cfg.health.totals.missing, 2);
  assert.equal(cfg.intel_fetched.tba, 1792000100000);
  // A later sync without intel leaves the External tab as it was.
  post({ health: { totals: { missing: 0 } } });
  assert.equal(ss.getSheetByName('External').objects().length, 3);
});

test('pick list: unscouted teams appear with EPA; TBA rank never overwrites the mentors\' pick rank', () => {
  const { ss, post } = dashboard();
  post({ intel: INTEL, teams: [{ team: 254, name: 'Cheesy Poofs' }, { team: 118, name: 'Robonauts' }, { team: 1507, name: 'Warlocks' }] });
  const web = loadProject('web', ss);
  web.saveRanking([118, 254]);
  const view = plain(web.getPickList());
  assert.deepEqual(view.teams.map(t => t.team), [118, 254, 4], 'ranked first, then the rest; 1507 left off');
  const t254 = view.teams.find(t => t.team === 254);
  assert.equal(t254.rank, 2, 'mentor pick rank');
  assert.equal(t254.rank_tba, 3, 'TBA rank kept separately');
  assert.equal(t254.epa, 70);
  assert.equal(t254.name, 'Cheesy Poofs');
  assert.equal(t254.matches, 0, 'not scouted yet');
  assert.equal(t254.fit_reason, 'set our gaps');
  assert.equal(view.intelFetched.statbotics, 1792000000000);
});

test('next match: our first unplayed match by default, any match on request, alliance EPA sums', () => {
  const { ss, post } = dashboard();
  post({ intel: INTEL, schedule: SCHEDULE, teams: [{ team: 254, name: 'Cheesy Poofs' }],
    records: [{ id: 1, qr: 'q1', event: EVENT, rkey: 'qm1|254|ada', match_key: 'qm1', team: 254, station: 'R2', scout_id: 'ada', ts: 1,
      app_version: '1.0.1', schema_version: 1, values: { ...emptyValues(), teleop_fuel_scored: 30, notes: 'fast shooter' } }] });
  const web = loadProject('web', ss);
  web.saveTag(254, 'Target');
  let d = plain(web.getNextMatch(null));
  assert.equal(d.key, 'qm3', 'qm1 has a result and qm2 has no 1507');
  assert.equal(d.ourColor, 'blue');
  assert.deepEqual(d.blue.teams.map(t => t.team), [1507, 254, 26]);
  assert.equal(d.blue.epa, 120);
  assert.equal(d.blue.epaCount, 2);
  assert.equal(d.blue.scouted, 30);
  const t254 = d.blue.teams[1];
  assert.equal(t254.tag, 'Target');
  assert.equal(t254.notes[0].text, 'fast shooter');
  assert.equal(d.red.epa, null, 'no EPA for any red team');
  assert.deepEqual(d.matches.filter(m => m.ours).map(m => m.key), ['qm1', 'qm3', 'qm4']);
  assert.deepEqual(d.matches[0].score, [120, 98]);

  post({ health: { playedThrough: 'qm3' } });   // laptop has scans through qm3 before TBA posts it
  assert.equal(plain(web.getNextMatch(null)).key, 'qm4');

  d = plain(web.getNextMatch('qm1'));
  assert.equal(d.key, 'qm1');
  assert.deepEqual(d.result, { red: 120, blue: 98, winner: 'red' });
});

test('next match / data health with no data yet do not crash', () => {
  const { ss } = dashboard();
  const web = loadProject('web', ss);
  assert.equal(plain(web.getNextMatch(null)).key, null);
  const hh = plain(web.getDataHealth());
  assert.equal(hh.health, null);
  assert.equal(hh.lastSyncMs, null);
});

test('data health returns the laptop report and freshness', () => {
  const { ss, post } = dashboard();
  post({ intel: INTEL, health: { playedThrough: 'qm2', playedThroughLabel: 'Qual 2', totals: { missing: 1, slots: 12 }, pending: 3 } });
  const hh = plain(loadProject('web', ss).getDataHealth());
  assert.equal(hh.health.pending, 3);
  assert.equal(hh.health.playedThroughLabel, 'Qual 2');
  assert.ok(hh.lastSyncMs > 0);
  assert.equal(hh.intelFetched.tba, 1792000100000);
});
