// ==============================================================================
// Setup QR codes, made by the scouting lead (lead tools now, laptop app later)
// and scanned by iPads.
//
// Config — scanned once per iPad; sets event, station, lead PIN and roster:
//   WCFG|<ver>|<event>|<station>|<pin>|<id>:<name>;<id>:<name>...|<crc32>
//
// Schedule — split into parts so each code stays easy to scan; the iPad
// collects every part of one revision ("rev") before switching over:
//   WSCH|<ver>|<event>|<rev>|<part>|<total>|<match_key>:<r1>,<r2>,<r3>,<b1>,<b2>,<b3>;...|<crc32>
//
// The PIN is stored as plain digits. It only stops casual changes on a scout
// iPad; it is not a security boundary (anyone holding the config QR has it).
// ==============================================================================

import { encodeFrame, decodeFrame, identifyCode, clean, EVENT_RE, SCOUT_ID_RE } from './codec.js';
import { parseMatchKey, compareMatchKeys, STATIONS } from './schedule.js';

const CONFIG_VERSION = 1;
const SCHEDULE_VERSION = 1;
export const MATCHES_PER_PART = 12;
const PIN_RE = /^\d{4,8}$/;
const REV_RE = /^[a-z0-9]{1,10}$/;

function cleanName(name) {
  return clean(name).replace(/[;:]/g, ' ').slice(0, 30);
}

// ---------- Config ----------
/** cfg: { event, station, pin, roster: [{ id, name }] } */
export function encodeConfig(cfg) {
  if (!EVENT_RE.test(cfg.event)) throw new Error(`Bad event code "${cfg.event}" (lowercase letters/digits, e.g. 2026nyro)`);
  if (!STATIONS.includes(cfg.station)) throw new Error(`Bad station "${cfg.station}"`);
  if (!PIN_RE.test(cfg.pin)) throw new Error('PIN must be 4–8 digits');
  for (const s of cfg.roster) {
    if (!SCOUT_ID_RE.test(s.id)) throw new Error(`Bad scout ID "${s.id}" (letters, digits, - or _, max 12)`);
  }
  const roster = cfg.roster.map(s => `${s.id}:${cleanName(s.name)}`).join(';');
  return encodeFrame(['WCFG', CONFIG_VERSION, cfg.event, cfg.station, cfg.pin, roster]);
}

/** Returns { ok: true, config } or { ok: false, reason }. */
export function decodeConfig(text) {
  if (identifyCode(text) !== 'config') return { ok: false, reason: 'Not a config QR code' };
  const parts = decodeFrame(text);
  if (!parts) return { ok: false, reason: 'Checksum failed — try scanning again' };
  const [, ver, event, station, pin, rosterStr] = parts;
  if (Number(ver) !== CONFIG_VERSION) return { ok: false, reason: `Config version ${ver} not supported — update the app` };
  if (!EVENT_RE.test(event) || !STATIONS.includes(station) || !PIN_RE.test(pin)) {
    return { ok: false, reason: 'Config QR has bad event, station or PIN' };
  }
  const roster = (rosterStr || '').split(';').filter(Boolean).map(entry => {
    const i = entry.indexOf(':');
    return { id: entry.slice(0, i), name: entry.slice(i + 1) };
  });
  if (!roster.length || roster.some(s => !SCOUT_ID_RE.test(s.id) || !s.name)) {
    return { ok: false, reason: 'Config QR has a bad or empty scout roster' };
  }
  return { ok: true, config: { event, station, pin, roster } };
}

// ---------- Schedule ----------
/**
 * sched: { event, rev, matches: [{ key, teams: [r1, r2, r3, b1, b2, b3] }] }
 * Returns an array of QR strings (one per part).
 */
export function encodeSchedule(sched, perPart = MATCHES_PER_PART) {
  if (!EVENT_RE.test(sched.event)) throw new Error(`Bad event code "${sched.event}"`);
  if (!REV_RE.test(sched.rev)) throw new Error(`Bad schedule revision "${sched.rev}"`);
  const matches = [...sched.matches].sort((a, b) => compareMatchKeys(a.key, b.key));
  for (const m of matches) {
    if (!parseMatchKey(m.key)) throw new Error(`Bad match key "${m.key}"`);
    if (m.teams.length !== 6 || m.teams.some(t => !/^\d{1,5}$/.test(String(t)))) {
      throw new Error(`Match ${m.key} needs exactly 6 team numbers`);
    }
  }
  const total = Math.max(1, Math.ceil(matches.length / perPart));
  const codes = [];
  for (let p = 0; p < total; p++) {
    const entries = matches.slice(p * perPart, (p + 1) * perPart)
      .map(m => `${m.key}:${m.teams.join(',')}`).join(';');
    codes.push(encodeFrame(['WSCH', SCHEDULE_VERSION, sched.event, sched.rev, p + 1, total, entries]));
  }
  return codes;
}

/** Returns { ok: true, part: { event, rev, part, total, matches: {key: teams} } } or { ok: false, reason }. */
export function decodeSchedulePart(text) {
  if (identifyCode(text) !== 'schedule') return { ok: false, reason: 'Not a schedule QR code' };
  const parts = decodeFrame(text);
  if (!parts) return { ok: false, reason: 'Checksum failed — try scanning again' };
  const [, ver, event, rev, partStr, totalStr, entries] = parts;
  if (Number(ver) !== SCHEDULE_VERSION) return { ok: false, reason: `Schedule version ${ver} not supported — update the app` };
  const part = Number(partStr), total = Number(totalStr);
  if (!EVENT_RE.test(event) || !REV_RE.test(rev) || !(part >= 1 && part <= total)) {
    return { ok: false, reason: 'Schedule QR has a bad header' };
  }
  const matches = {};
  for (const entry of (entries || '').split(';').filter(Boolean)) {
    const [key, teamStr] = entry.split(':');
    const teams = (teamStr || '').split(',').map(Number);
    if (!parseMatchKey(key) || teams.length !== 6 || teams.some(t => !(t >= 1))) {
      return { ok: false, reason: `Schedule QR has a bad match entry "${entry}"` };
    }
    matches[key] = teams;
  }
  return { ok: true, part: { event, rev, part, total, matches } };
}

/**
 * Adds a decoded part to an in-progress collection for the same event+rev.
 * collection: { event, rev, total, parts: { [n]: matches } } or null.
 * Returns the updated collection; a part from a different event/rev starts a fresh one.
 */
export function addSchedulePart(collection, part) {
  const same = collection && collection.event === part.event && collection.rev === part.rev;
  const c = same ? { ...collection, parts: { ...collection.parts } }
    : { event: part.event, rev: part.rev, total: part.total, parts: {} };
  c.parts[part.part] = part.matches;
  return c;
}

/** Part numbers still missing from a collection. */
export function missingParts(collection) {
  const missing = [];
  for (let n = 1; n <= collection.total; n++) if (!collection.parts[n]) missing.push(n);
  return missing;
}

/** Full schedule { [matchKey]: teams } once every part is in, else null. */
export function completeSchedule(collection) {
  if (!collection || missingParts(collection).length) return null;
  return Object.assign({}, ...Object.values(collection.parts));
}
