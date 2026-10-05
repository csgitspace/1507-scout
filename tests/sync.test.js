import { test } from 'node:test';
import assert from 'node:assert/strict';

import { openDb } from '../laptop/db.js';
import { ingest } from '../laptop/intake.js';
import { createSync } from '../laptop/sync.js';
import { encodeRecord } from '../shared/codec.js';
import { emptyValues } from '../shared/fields.js';
import { FakeSpreadsheet, loadProject } from './helpers/fake-apps-script.js';

const EVENT = '2026test';
const URL = 'https://script.google.com/macros/s/FAKE/exec';

function station(n = 3) {
  const store = openDb(':memory:');
  store.setSetting('event', EVENT);
  store.setSetting('roster', [{ id: 'ada', name: 'Ada L.' }]);
  store.setSetting('syncUrl', URL);
  store.setSetting('syncToken', 'secret-token');
  store.replaceSchedule(EVENT, [{ key: 'qm1', teams: [1, 2, 3, 4, 5, 6] }]);
  store.setSetting(`scheduleRev:${EVENT}`, 'r1');
  for (let i = 0; i < n; i++) {
    ingest(store, encodeRecord({ app_version: '1.0.1', event: EVENT, match_key: 'qm1', team: i + 1, scout_id: 'ada',
      station: ['R1', 'R2', 'R3', 'B1', 'B2', 'B3'][i % 6], ts: 1790000000 + i, values: { ...emptyValues(), primary_role: 0 } }));
  }
  return store;
}

/** fetch stand-in that records requests and answers like the endpoint. */
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, opts) => {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const out = await handler(body, calls.length);
    if (out instanceof Error) throw out;
    return { ok: true, status: 200, text: async () => JSON.stringify(out) };
  };
  fn.calls = calls;
  return fn;
}

test('sync sends unsynced records, marks confirmed ones, then sends only a heartbeat', async () => {
  const store = station(3);
  const fetchImpl = fakeFetch(body => ({ ok: true, accepted: body.records.map(r => r.id), added: body.records.length }));
  const sync = createSync({ store, fetchImpl });
  let s = await sync.syncOnce();
  assert.equal(s.lastError, null);
  assert.equal(s.pending, 0);
  assert.equal(fetchImpl.calls[0].records.length, 3);
  assert.equal(fetchImpl.calls[0].token, 'secret-token');
  assert.equal(fetchImpl.calls[0].records[0].scout_name, 'Ada L.');
  assert.ok(fetchImpl.calls[0].schedule, 'schedule sent the first time');
  s = await sync.syncOnce();
  assert.equal(fetchImpl.calls[1].records.length, 0, 'heartbeat: nothing resent');
  assert.equal(fetchImpl.calls[1].schedule, undefined, 'schedule not resent until it changes');
});

test('a failed push leaves records pending and the next run catches up', async () => {
  const store = station(2);
  let offline = true;
  const fetchImpl = fakeFetch(body => (offline ? new TypeError('fetch failed') : { ok: true, accepted: body.records.map(r => r.id), added: 2 }));
  const sync = createSync({ store, fetchImpl });
  let s = await sync.syncOnce();
  assert.match(s.lastError, /phone tethered/);
  assert.equal(s.pending, 2);
  offline = false;
  s = await sync.syncOnce();
  assert.equal(s.lastError, null);
  assert.equal(s.pending, 0);
});

test('only records the endpoint confirms are marked synced; errors surface their reason', async () => {
  const store = station(3);
  const fetchImpl = fakeFetch((body, n) => (n === 1 ? { ok: true, accepted: [body.records[0].id], added: 1 } : { ok: false, error: 'Bad sync token' }));
  const sync = createSync({ store, fetchImpl });
  let s = await sync.syncOnce();
  assert.equal(s.pending, 2);
  s = await sync.syncOnce();
  assert.equal(s.lastError, 'Bad sync token');
});

test('large backlogs go in batches', async () => {
  const store = station(7);
  const fetchImpl = fakeFetch(body => ({ ok: true, accepted: body.records.map(r => r.id), added: body.records.length }));
  const sync = createSync({ store, fetchImpl, batchSize: 3 });
  const s = await sync.syncOnce();
  assert.deepEqual(fetchImpl.calls.map(c => c.records.length), [3, 3, 1]);
  assert.equal(s.pending, 0);
});

test('not configured -> clear message, no request', async () => {
  const store = openDb(':memory:');
  store.setSetting('event', EVENT);
  const fetchImpl = fakeFetch(() => ({ ok: true }));
  const s = await createSync({ store, fetchImpl }).syncOnce();
  assert.equal(s.configured, false);
  assert.match(s.lastError, /dashboard:push/);
  assert.equal(fetchImpl.calls.length, 0);
});

test('Workspace sign-in: a Google token rides along, and Google sign-in pages become clear errors', async () => {
  const store = station(1);
  const tokenSource = { configured: () => true, account: () => 'scout@warlocks1507.com', token: async () => 'ya29.test' };
  const seen = [];
  let reply = { ok: true, accepted: [], added: 0 };
  const fetchImpl = async (url, opts) => {
    seen.push(opts.headers.Authorization);
    return typeof reply === 'string'
      ? { ok: true, status: 200, text: async () => reply }
      : { ok: true, status: 200, text: async () => JSON.stringify({ ...reply, accepted: JSON.parse(opts.body).records.map(r => r.id) }) };
  };
  const sync = createSync({ store, fetchImpl, tokenSource });
  let s = await sync.syncOnce();
  assert.equal(seen[0], 'Bearer ya29.test');
  assert.equal(s.googleAccount, 'scout@warlocks1507.com');
  reply = '<html><head><title>Authorization needed</title></head></html>';
  s = await sync.syncOnce();
  assert.match(s.lastError, /station:login/);
  reply = '<html><head><title>Access Denied</title></head></html>';
  s = await sync.syncOnce();
  assert.match(s.lastError, /warlocks1507\.com account/);
});

test('token source refreshes once and caches; a revoked sign-in says how to fix it', async () => {
  const { createTokenSource } = await import('../laptop/google-auth.js');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { tmpdir } = await import('node:os');
  const dir = mkdtempSync(join(tmpdir(), 'scout-auth-'));
  const file = join(dir, 'google-auth.json');
  writeFileSync(file, JSON.stringify({ client_id: 'c', client_secret: 's', refresh_token: 'r', email: 'a@warlocks1507.com' }));
  let calls = 0, grant = 'ok';
  const fetchImpl = async () => { calls++; return { status: 200, json: async () => (grant === 'ok' ? { access_token: `tok${calls}`, expires_in: 3600 } : { error: 'invalid_grant' }) }; };
  try {
    const src = createTokenSource(file, { fetchImpl });
    assert.equal(src.account(), 'a@warlocks1507.com');
    assert.equal(await src.token(), 'tok1');
    assert.equal(await src.token(), 'tok1', 'cached');
    assert.equal(calls, 1);
    grant = 'revoked';
    await assert.rejects(createTokenSource(file, { fetchImpl }).token(), /station:login/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('end to end: laptop sync -> real sync-endpoint code -> Sheet, twice, no duplicates', async () => {
  const store = station(4);
  const ss = new FakeSpreadsheet();
  const endpoint = loadProject('sync-endpoint', ss);
  const fetchImpl = async (url, opts) => ({
    ok: true, status: 200, text: async () => endpoint.doPost({ postData: { contents: opts.body } }).getContent(),
  });
  const sync = createSync({ store, fetchImpl });
  assert.equal((await sync.syncOnce()).lastError, null);
  assert.equal((await sync.syncOnce()).lastError, null);
  assert.equal(ss.getSheetByName('Raw').objects().length, 4);
  assert.equal(ss.getSheetByName('Summary').objects().length, 4);
  assert.equal(ss.getSheetByName('Matches').objects()[0].match_key, 'qm1');
});
