// ==============================================================================
// HTTP handler for the scan station: serves the station web page and a small
// JSON API. Kept separate from server.js so tests can drive it directly.
//
//   GET  /api/state           settings, schedule summary, counts
//   POST /api/scan            { text, source }  -> intake result
//   GET  /api/coverage        missing-scan grid
//   POST /api/played          { key | null }  "played through" marker
//   GET  /api/records         current records + recent scan log
//   POST /api/settings        { event, pin, roster, tbaKey }
//   POST /api/schedule        { text } | { practice: { teams, count } }
//   POST /api/schedule/tba    import schedule + teams from The Blue Alliance
//   GET  /api/codes           iPad config codes (one per station) + schedule parts
//   GET  /api/export.csv      current records as a spreadsheet
// ==============================================================================

import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ingest } from './intake.js';
import { coverage } from './coverage.js';
import { importEvent } from './tba.js';
import { EVENT_RE } from '../shared/codec.js';
import { FIELDS, displayValue } from '../shared/fields.js';
import { STATIONS, orderedKeys, matchLabel } from '../shared/schedule.js';
import { encodeConfig, encodeSchedule } from '../shared/setup-codes.js';
import { parseRoster, rosterToText, parseScheduleText, practiceSchedule } from '../shared/lead-input.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
// Only these folders are served — never data/, legacy/ or anything else.
const STATIC_PREFIXES = ['/laptop/public/', '/shared/', '/scout-app/'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function createHandler({ store, fetchImpl = fetch }) {
  const event = () => store.getSetting('event');
  const scheduleMatches = (ev) => orderedKeys(store.schedule(ev)).map(k => ({ key: k, teams: store.schedule(ev)[k] }));

  function setSchedule(ev, matches) {
    store.replaceSchedule(ev, matches);
    store.setSetting(`scheduleRev:${ev}`, Date.now().toString(36).slice(-6));
  }

  function state() {
    const ev = event();
    const roster = store.getSetting('roster', []);
    const schedule = ev ? store.schedule(ev) : {};
    return {
      event: ev,
      eventName: ev ? store.getSetting(`eventName:${ev}`) : null,
      pin: store.getSetting('pin'),
      roster,
      rosterText: rosterToText(roster),
      hasTbaKey: !!(process.env.TBA_KEY || store.getSetting('tbaKey')),
      playedThrough: ev ? store.getSetting(`playedThrough:${ev}`) : null,
      matchKeys: orderedKeys(schedule),
      scheduleRev: ev ? store.getSetting(`scheduleRev:${ev}`) : null,
      teams: ev ? store.teams(ev).length : 0,
      counts: store.counts(ev || ''),
    };
  }

  const routes = {
    'GET /api/state': () => state(),

    'POST /api/scan': (body) => ingest(store, body.text, { source: body.source || 'manual' }),

    'GET /api/coverage': () => {
      const ev = event();
      if (!ev) return { rows: [], missing: [], extras: [], totals: { slots: 0, scanned: 0, missing: 0 }, playedThrough: null };
      return coverage(store.schedule(ev), store.currentRecords(ev), { playedThrough: store.getSetting(`playedThrough:${ev}`) });
    },

    'POST /api/played': (body) => {
      const ev = event();
      if (!ev) throw new HttpError(400, 'Set the event first');
      store.setSetting(`playedThrough:${ev}`, body.key || null);
      return { ok: true };
    },

    'GET /api/records': () => {
      const ev = event();
      const names = Object.fromEntries(store.getSetting('roster', []).map(s => [s.id, s.name]));
      return {
        records: ev ? store.currentRecords(ev).map(r => ({ ...r, scout_name: names[r.scout_id] || r.scout_id })) : [],
        scans: store.recentScans(40),
      };
    },

    'POST /api/settings': (body) => {
      const ev = String(body.event || '').trim().toLowerCase();
      const pin = String(body.pin || '').trim();
      const roster = parseRoster(body.roster);
      if (!EVENT_RE.test(ev)) throw new HttpError(400, 'Event code must be the TBA key, e.g. 2026nyro (lowercase letters and digits)');
      if (!/^\d{4,8}$/.test(pin)) throw new HttpError(400, 'Lead PIN must be 4–8 digits');
      if (!roster.length) throw new HttpError(400, 'Add at least one scout to the roster');
      store.setSetting('event', ev);
      store.setSetting('pin', pin);
      store.setSetting('roster', roster);
      if (typeof body.tbaKey === 'string' && body.tbaKey.trim()) store.setSetting('tbaKey', body.tbaKey.trim());
      return state();
    },

    'POST /api/schedule': (body) => {
      const ev = event();
      if (!ev) throw new HttpError(400, 'Save the event settings first');
      let matches;
      try {
        matches = body.practice
          ? practiceSchedule(String(body.practice.teams || '').split(/[\s,]+/), Math.min(150, Math.max(1, Number(body.practice.count) || 20)))
          : parseScheduleText(body.text);
      } catch (err) {
        throw new HttpError(400, err.message);
      }
      if (!matches.length) throw new HttpError(400, 'The schedule is empty');
      setSchedule(ev, matches);
      return { ok: true, matches: matches.length };
    },

    'POST /api/schedule/tba': async () => {
      const ev = event();
      if (!ev) throw new HttpError(400, 'Save the event settings first');
      const key = process.env.TBA_KEY || store.getSetting('tbaKey');
      if (!key) throw new HttpError(400, 'Enter the TBA read key on this screen first');
      let data;
      try { data = await importEvent(ev, key, fetchImpl); } catch (err) { throw new HttpError(502, err.message); }
      store.setSetting(`eventName:${ev}`, data.name);
      if (data.teams.length) store.replaceTeams(ev, data.teams);
      if (!data.matches.length) {
        return { ok: true, matches: 0, teams: data.teams.length, name: data.name,
          note: "TBA doesn't have a match schedule for this event yet. Teams were imported; try again once the schedule is out." };
      }
      setSchedule(ev, data.matches);
      return { ok: true, matches: data.matches.length, teams: data.teams.length, name: data.name };
    },

    'GET /api/codes': () => {
      const ev = event();
      const pin = store.getSetting('pin');
      const roster = store.getSetting('roster', []);
      if (!ev || !pin || !roster.length) throw new HttpError(400, 'Save the event settings first');
      const matches = scheduleMatches(ev);
      return {
        event: ev,
        config: STATIONS.map(station => ({ station, code: encodeConfig({ event: ev, station, pin, roster }) })),
        schedule: matches.length ? encodeSchedule({ event: ev, rev: store.getSetting(`scheduleRev:${ev}`) || 'r1', matches }) : [],
        matches: matches.length,
      };
    },
  };

  function exportCsv() {
    const ev = event();
    const names = Object.fromEntries(store.getSetting('roster', []).map(s => [s.id, s.name]));
    const cell = (v) => { const s = String(v ?? ''); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const header = ['event', 'match_key', 'match', 'team', 'station', 'scout_id', 'scout_name', 'scouted_at', 'app_version',
      ...FIELDS.map(f => f.key)];
    const rows = (ev ? store.currentRecords(ev) : []).map(r => [
      r.event, r.match_key, matchLabel(r.match_key), r.team, r.station, r.scout_id, names[r.scout_id] || '',
      new Date(r.ts * 1000).toISOString(), r.app_version,
      ...FIELDS.map(f => (f.type === 'counter' ? r.values[f.key] : displayValue(f, r.values[f.key]))),
    ]);
    return [header, ...rows].map(row => row.map(cell).join(',')).join('\r\n');
  }

  async function serveStatic(path, res) {
    if (path === '/' || path === '/laptop/public') {
      // Redirect (not rewrite) so the page's relative links resolve under /laptop/public/.
      res.writeHead(302, { Location: '/laptop/public/' });
      return res.end();
    }
    if (path.endsWith('/')) path += 'index.html';
    if (!STATIC_PREFIXES.some(p => path.startsWith(p))) throw new HttpError(404, 'Not found');
    const file = normalize(join(ROOT, path));
    if (!file.startsWith(ROOT) || file.includes(`${sep}..`)) throw new HttpError(403, 'Forbidden');
    let content;
    try { content = await readFile(file); } catch { throw new HttpError(404, 'Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(content);
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
        if (data.length > 1e6) { reject(new HttpError(413, 'Request too large')); req.destroy(); }
      });
      req.on('end', () => {
        if (!data) return resolve({});
        try { resolve(JSON.parse(data)); } catch { reject(new HttpError(400, 'Bad JSON')); }
      });
      req.on('error', reject);
    });
  }

  return async function handler(req, res) {
    const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    try {
      if (path === '/api/export.csv') {
        const ev = event() || 'scouting';
        res.writeHead(200, {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="${ev}-records-${new Date().toISOString().slice(0, 10)}.csv"`,
        });
        return res.end('﻿' + exportCsv()); // BOM so Excel reads UTF-8 notes correctly
      }
      const route = routes[`${req.method} ${path}`];
      if (route) {
        const body = req.method === 'POST' ? await readBody(req) : {};
        const out = await route(body);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(JSON.stringify(out));
      }
      if (path.startsWith('/api/')) throw new HttpError(404, 'Unknown API route');
      if (req.method !== 'GET') throw new HttpError(405, 'Method not allowed');
      await serveStatic(path, res);
    } catch (err) {
      const status = err.status || 500;
      if (status === 500) console.error(err);
      if (!res.headersSent) res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: err.message }));
    }
  };
}
