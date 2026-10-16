// ==============================================================================
// Sync job: pushes records to the dashboard's sync endpoint over the
// USB-tethered phone. server.js runs it every 3 minutes, plus "Sync now".
//
// Safe to retry at any time. Records stay "unsynced" until the endpoint
// confirms them, and the endpoint ignores any it already has. A failed push
// (phone unplugged, no signal) just means the next run sends more. Every run
// POSTs, even with nothing new, so the dashboard's "Synced N min ago" shows
// the laptop is alive.
//
// Where the URL + token come from: data/dashboard.json (written by
// `npm run dashboard:push` on this laptop), or entered by hand on Event setup.
// ==============================================================================

import { existsSync, readFileSync } from 'node:fs';
import { intelSignature } from './intel.js';

// intelFor(event) -> { external, results, fetched } (laptop/intel.js externalFor): sent only when it changes.
// healthFor(event) -> Data health payload (laptop/coverage.js health): sent every run, it's small.
// seasonFor(event) -> { year, fetchedAt, teams, sig } (laptop/intel.js): match13 season ratings for Lookup;
//   big, so sent only when sig changes.
export function createSync({ store, dashboardFile = null, tokenSource = null, fetchImpl = fetch, now = () => Date.now(), batchSize = 300,
  intelFor = null, healthFor = null, seasonFor = null }) {
  const status = { lastAttempt: null, lastSuccess: null, lastError: null, lastAdded: 0, running: false };

  function config() {
    let file = {};
    try { if (dashboardFile && existsSync(dashboardFile)) file = JSON.parse(readFileSync(dashboardFile, 'utf8')); } catch { /* unreadable: ignore */ }
    const manualUrl = store.getSetting('syncUrl');
    const manualToken = store.getSetting('syncToken');
    return {
      url: manualUrl || (file['sync-endpoint'] && file['sync-endpoint'].url) || null,
      token: manualToken || file.token || null,
      dashboardUrl: store.getSetting('dashboardUrl') || (file.web && file.web.url) || null,
      source: manualUrl ? 'entered on Event setup' : file.token ? 'data/dashboard.json' : null,
    };
  }

  async function post(url, body) {
    const headers = { 'Content-Type': 'application/json' };
    // Workspace deployments only accept domain users: prove who we are (see google-auth.js).
    if (tokenSource && tokenSource.configured()) headers.Authorization = `Bearer ${await tokenSource.token()}`;
    let res;
    try {
      // Apps Script answers a POST with a redirect to the result; fetch follows it.
      res = await fetchImpl(url, {
        method: 'POST', headers, body: JSON.stringify(body),
        redirect: 'follow', signal: AbortSignal.timeout(60000),
      });
    } catch (err) {
      if (err.name === 'TimeoutError') throw new Error('Google took too long to answer — will retry');
      throw new Error("Can't reach Google — is the phone tethered and on cellular data?");
    }
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      if (/<title>Authorization needed/i.test(text) || res.status === 401) {
        throw new Error('Google wants a sign-in — run  npm run station:login  (team warlocks1507.com account)');
      }
      if (/<title>Access Denied/i.test(text) || res.status === 403) {
        throw new Error('Google refused access — the station must be signed in with a warlocks1507.com account (npm run station:login)');
      }
      throw new Error(res.ok ? 'Unexpected reply from Google — check the sync URL' : `Google replied HTTP ${res.status}`);
    }
    if (!json.ok) throw new Error(json.error || 'The dashboard rejected the sync');
    return json;
  }

  function payloadFor(rec, names) {
    return {
      id: rec.id, qr: rec.qr, event: rec.event, rkey: rec.rkey, match_key: rec.match_key, team: rec.team,
      station: rec.station, scout_id: rec.scout_id, scout_name: names[rec.scout_id] || '', ts: rec.ts,
      app_version: rec.app_version, schema_version: rec.schema_version, values: rec.values,
    };
  }

  function pitPayloadFor(rec, names) {
    return {
      id: rec.id, qr: rec.qr, event: rec.event, rkey: rec.rkey, team: rec.team, scout_id: rec.scout_id,
      scout_name: names[rec.scout_id] || '', ts: rec.ts, app_version: rec.app_version, schema_version: rec.schema_version, values: rec.values,
    };
  }

  function getStatus() {
    const cfg = config();
    const event = store.getSetting('event');
    return {
      ...status,
      configured: !!(cfg.url && cfg.token),
      source: cfg.source,
      googleAccount: tokenSource && tokenSource.configured() ? tokenSource.account() : null,
      dashboardUrl: cfg.dashboardUrl,
      pending: event ? store.countUnsynced(event) + store.countUnsyncedPit(event) : 0,
    };
  }

  async function syncOnce() {
    if (status.running) return getStatus();
    const cfg = config();
    const event = store.getSetting('event');
    if (!cfg.url || !cfg.token) {
      status.lastError = 'Not set up yet — run  npm run dashboard:push  on this laptop, or enter the sync URL and token on Event setup';
      return getStatus();
    }
    if (!event) { status.lastError = 'Set the event on Event setup first'; return getStatus(); }

    status.running = true;
    status.lastAttempt = now();
    try {
      const names = Object.fromEntries(store.getSetting('roster', []).map(s => [s.id, s.name]));
      // Schedule + teams go along only when they've changed since the last confirmed sync.
      const metaSig = `${store.getSetting(`scheduleRev:${event}`) || ''}:${store.teams(event).length}`;
      let sendMeta = metaSig !== store.getSetting(`syncedMeta:${event}`);
      const intel = intelFor ? intelFor(event) : null;
      const intelSig = intel ? intelSignature(intel) : null;
      let sendIntel = !!intel && intelSig !== store.getSetting(`syncedIntel:${event}`);
      const season = seasonFor ? seasonFor(event) : null;
      let sendSeason = !!season && season.sig !== store.getSetting(`syncedSeason:${season.year}`);
      let added = 0;
      for (let round = 0; round < 10; round++) {
        const recs = store.unsyncedRecords(event, batchSize);
        const pits = store.unsyncedPit(event, batchSize);
        const body = {
          token: cfg.token, event, eventName: store.getSetting(`eventName:${event}`) || '',
          records: recs.map(r => payloadFor(r, names)),
        };
        if (pits.length) body.pit = pits.map(p => pitPayloadFor(p, names));
        if (sendMeta) {
          const sched = store.schedule(event);
          body.schedule = Object.keys(sched).map(key => ({ key, teams: sched[key] }));
          body.teams = store.teams(event);
        }
        if (sendIntel) body.intel = intel;
        if (sendSeason) body.season = { year: season.year, fetchedAt: season.fetchedAt, teams: season.teams };
        // "waiting" = what's still on the laptop once this request lands
        if (healthFor) body.health = { ...healthFor(event), pending: Math.max(0, store.countUnsynced(event) - recs.length) };
        const res = await post(cfg.url, body);
        const sent = new Set(recs.map(r => r.id));
        store.markSynced((res.accepted || []).filter(id => sent.has(id)), now());
        const sentPit = new Set(pits.map(p => p.id));
        store.markPitSynced((res.acceptedPit || []).filter(id => sentPit.has(id)), now());
        if (sendMeta) { store.setSetting(`syncedMeta:${event}`, metaSig); sendMeta = false; }
        if (sendIntel) { store.setSetting(`syncedIntel:${event}`, intelSig); sendIntel = false; }
        if (sendSeason) { store.setSetting(`syncedSeason:${season.year}`, season.sig); sendSeason = false; }
        added += (res.added || 0) + (res.addedPit || 0);
        if (recs.length < batchSize && pits.length < batchSize) break;
      }
      status.lastSuccess = now();
      status.lastError = null;
      status.lastAdded = added;
    } catch (err) {
      status.lastError = err.message;
    } finally {
      status.running = false;
    }
    return getStatus();
  }

  return { syncOnce, getStatus, config };
}
