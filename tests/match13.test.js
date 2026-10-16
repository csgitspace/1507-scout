import { test } from 'node:test';
import assert from 'node:assert/strict';

import { m13Get, parseM13EventTeams, parseM13Matches, parseM13Sim, fetchM13Season, M13_BASE } from '../laptop/match13.js';
import { createIntel, externalFor, seasonFor } from '../laptop/intel.js';
import { createSync } from '../laptop/sync.js';
import { openDb } from '../laptop/db.js';
import { FakeSpreadsheet, loadProject, plain } from './helpers/fake-apps-script.js';

// Made-up numbers in match13's documented response shapes (docs: www.match13.com/docs/api).
const EVENT = '2026test';
const KEY = 'm13_live_TESTKEY0123456789';
const eventTeamRow = (team, xp, extra = {}) => ({ teamNumber: team, xpStart: xp - 5, xpEnd: xp, xAuto: 20.04, xTele: xp - 22, xEnd: 2,
  xVar: 400, xRp1: 0.81234, xRp2: 0.3, xRp3: 0.05, epa: xp - 3, opr: null, dpr: null, components: {}, ...extra });
const EVENT_TEAMS = { eventKey: EVENT, teams: [eventTeamRow(254, 150.04), eventTeamRow(1507, 120), eventTeamRow(33, 60, { xpEnd: null })] };
const MATCHES = { eventKey: EVENT, year: 2026, matches: [
  { key: `${EVENT}_qm1`, bye: false, pred: { winProb: 0.6421, redScore: 148.26, blueScore: 131.1, redVar: 1, blueVar: 1,
    redRp1: null, redRp2: null, redRp3: null, blueRp1: null, blueRp2: null, blueRp3: null }, teams: {} },
  { key: 'qm2', pred: { winProb: 0.3, redScore: 90, blueScore: 110 }, teams: {} },
] };
const SIM = { eventKey: EVENT, year: 2026, iterations: 1000, simmedAt: 1, teams: [
  { teamNumber: 254, meanRank: 1.4, meanRps: 3.21, p5: 1, p50: 1, p95: 3 }, { teamNumber: 1507, meanRank: 5, meanRps: 2.5, p5: 2, p50: 5, p95: 9 }] };
const seasonRow = (team, xp, rank) => ({ teamNumber: team, xp, xAuto: 10, xTele: xp - 12, xEnd: 2, xVar: 225, rank, percentile: 99.5 - rank / 10,
  epa: xp + 1, opr: xp + 2, dpr: 1, normXp: 1500, xRp1: 0.5, xRp2: 0.5, xRp3: 0.5, year: 2026 });

/** fetch stand-in: routes by path, records requests. */
function fakeM13(routes) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url, auth: opts && opts.headers && opts.headers.Authorization });
    const path = url.replace(M13_BASE, '');
    const hit = Object.entries(routes).find(([p]) => path.startsWith(p));
    const out = hit ? (typeof hit[1] === 'function' ? hit[1](path) : hit[1]) : { status: 404 };
    const status = out.status || 200;
    return { ok: status < 400, status, headers: { get: (h) => (out.headers || {})[h.toLowerCase()] || null },
      json: async () => out.body ?? out };
  };
  fn.calls = calls;
  return fn;
}

test('match13 parsers: xP with parts and spread, forecasts by short match key, projected ranks', () => {
  const teams = parseM13EventTeams(EVENT_TEAMS);
  assert.deepEqual(teams[0], { team: 254, xp: 150, auto: 20, tele: 128, end: 2, sd: 20, rp1: 0.81, rp2: 0.3, rp3: 0.05, epa: 147 });
  assert.equal(teams.find(t => t.team === 33).xp, 55, 'before playing here, xpStart');
  assert.deepEqual(parseM13Matches(MATCHES), [
    { key: 'qm1', redWin: 0.64, redScore: 148.3, blueScore: 131.1 }, { key: 'qm2', redWin: 0.3, redScore: 90, blueScore: 110 }]);
  assert.deepEqual(parseM13Sim(SIM)[1507], { rank: 5, lo: 2, hi: 9, rps: 2.5 });
});

test('match13 requests carry the key; 401 / 429 / 404 / 500 become clear outcomes', async () => {
  const f = fakeM13({
    '/ok': { a: 1 },
    '/gone': { status: 404 },
    '/nokey': { status: 401 },
    '/slow': { status: 429, headers: { 'retry-after': '42' } },
    '/broken': { status: 500, body: { detail: 'database busy' } },
  });
  assert.deepEqual(await m13Get('/ok', KEY, f), { a: 1 });
  assert.equal(f.calls[0].auth, `Bearer ${KEY}`);
  assert.equal(await m13Get('/gone', KEY, f), null);
  await assert.rejects(m13Get('/nokey', KEY, f), /key not accepted/);
  await assert.rejects(m13Get('/slow', KEY, f), /rate limit reached — wait 42 s/);
  await assert.rejects(m13Get('/broken', KEY, f), /match13 error 500: database busy/);
});

test('season ratings: every page, offseason included, sorted by team', async () => {
  const f = fakeM13({
    '/v1/years/2026/teams': (path) => (path.includes('page=1')
      ? { teams: [seasonRow(254, 140, 3), seasonRow(1507, 125.65, 421)], nextPage: 2 }
      : { teams: [seasonRow(33, 70, 900)], nextPage: null }),
  });
  const rows = await fetchM13Season(2026, KEY, f);
  assert.deepEqual(rows.map(r => r.team), [33, 254, 1507]);
  assert.equal(rows[2].xp, 125.7);
  assert.equal(rows[2].sd, 15);
  assert.ok(f.calls.every(c => c.url.includes('scope=all')));
  assert.equal(f.calls.length, 2);
});

function station() {
  const store = openDb(':memory:');
  store.setSetting('event', EVENT);
  store.replaceTeams(EVENT, [{ team: 254, name: 'A' }, { team: 1507, name: 'B' }, { team: 33, name: 'C' }]);
  return store;
}
const routes = () => ({
  [`/v1/events/${EVENT}/teams`]: EVENT_TEAMS,
  [`/v1/events/${EVENT}/matches`]: MATCHES,
  [`/v1/events/${EVENT}/sim`]: SIM,
  '/v1/years/2026/teams': { teams: [seasonRow(254, 140, 3), seasonRow(1507, 125.65, 421)], nextPage: null },
  'https://www.thebluealliance.com': { status: 404 },
});

test('scan station: no key = no match13 requests; with a key, xP / projected rank / forecasts reach the dashboard payload', async () => {
  const store = station();
  let f = fakeM13(routes());
  const quiet = createIntel({ store, fetchImpl: f });
  await quiet.refreshDue();
  assert.equal(f.calls.filter(c => c.url.startsWith(M13_BASE)).length, 0, 'optional: nothing without a key');
  assert.equal(quiet.getStatus().hasM13Key, false);

  store.setSetting('m13Key', KEY);
  f = fakeM13(routes());
  let t = 0;
  const intel = createIntel({ store, fetchImpl: f, now: () => t });
  await intel.refreshDue();
  const m13Calls = () => f.calls.filter(c => c.url.startsWith(M13_BASE)).length;
  assert.equal(m13Calls(), 4, 'event teams + matches + sim + one season page');
  t += 3 * 60 * 1000;
  await intel.refreshDue();
  assert.equal(m13Calls(), 4, 'nothing again 3 minutes later');
  t += 3 * 60 * 1000;
  await intel.refreshDue();
  assert.equal(m13Calls(), 7, 'event data again after 5+ minutes; season waits 6 hours');

  const st = intel.getStatus().match13;
  assert.equal(st.lastError, null);
  assert.equal(st.teams, 3);
  assert.equal(st.forecasts, 2);
  assert.equal(st.seasonTeams, 2);

  const ext = externalFor(store, EVENT);
  const row = ext.external.find(r => r.team === 1507);
  assert.equal(row.xp, 120);
  assert.equal(row.sim_rank, 5);
  assert.equal(row.sim_hi, 9);
  assert.equal(row.epa, 117, 'no Statbotics EPA here, so match13 copy fills in');
  assert.equal(row.epa_source, 'match13');
  assert.equal(ext.forecasts[0].key, 'qm1');
  assert.ok(ext.fetched.match13 !== null);
  assert.equal(seasonFor(store, EVENT).teams.length, 2);
});

test('sync: Forecast tab, Season tab (sent once, not every run), Lookup and Next match read them', async () => {
  const store = station();
  store.setSetting('m13Key', KEY);
  store.setSetting('syncUrl', 'https://script.google.com/macros/s/FAKE/exec');
  store.setSetting('syncToken', 'secret-token');
  store.replaceSchedule(EVENT, [{ key: 'qm1', teams: [254, 1507, 33, 4, 5, 6] }]);
  await createIntel({ store, fetchImpl: fakeM13(routes()) }).refreshDue();

  const ss = new FakeSpreadsheet();
  const endpoint = loadProject('sync-endpoint', ss);
  const bodies = [];
  const fetchImpl = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return { ok: true, status: 200, text: async () => endpoint.doPost({ postData: { contents: opts.body } }).getContent() };
  };
  const sync = createSync({ store, fetchImpl, intelFor: (ev) => externalFor(store, ev), seasonFor: (ev) => seasonFor(store, ev) });
  assert.equal((await sync.syncOnce()).lastError, null);
  await sync.syncOnce();
  assert.ok(bodies[0].season, 'season goes up the first time');
  assert.equal(bodies[1].season, undefined, 'and not again while unchanged');
  assert.equal(ss.getSheetByName('Season').objects().length, 2);
  assert.ok(ss.getSheetByName('Season').protections.length);
  assert.equal(ss.getSheetByName('Forecast').objects()[0].red_win, 0.64);

  const web = loadProject('web', ss);
  const next = plain(web.getNextMatch('qm1'));
  assert.deepEqual(next.forecast, { redWin: 0.64, red: 148.3, blue: 131.1 });
  const us = plain(web.getPickList()).us;
  assert.equal(us.xp, 120);

  const look = plain(web.getTeamLookup(254));
  assert.equal(look.season.xp, 140);
  assert.equal(look.season.rank, 3);
  assert.equal(look.here.sim_rank, 1);
  assert.equal(look.seasonInfo.teams, 2);
  const away = plain(web.getTeamLookup(9999));
  assert.equal(away.season, null);
  assert.equal(away.here, null);
  assert.throws(() => web.getTeamLookup('abc'), /Bad team number/);
});
