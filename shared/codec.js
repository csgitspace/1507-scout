// ==============================================================================
// Match record <-> QR text.
//
// Every QR code this system produces is a "frame": pipe-separated parts with
// a CRC32 checksum on the end, so a garbled scan is caught instead of stored.
//
//   W|<app_ver>|<schema_ver>|<event>|<match_key>|<team>|<scout_id>|<station>|<unix_ts>|<field values...>|<crc32>
//
// Field values appear in the order of FIELDS in fields.js. Runs unchanged in
// the browser (iPad app) and in Node (laptop app, tests).
// ==============================================================================

import { FIELDS, SCHEMA_VERSION } from './fields.js';
import { parseMatchKey, STATIONS } from './schedule.js';

export const RECORD_TAG = 'W';
const HEADER_LEN = 9; // W, app_ver, schema_ver, event, match_key, team, scout_id, station, ts

// ---------- CRC32 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

/** CRC32 of a string's UTF-8 bytes, as 8 lowercase hex characters. */
export function crc32(str) {
  let c = 0xFFFFFFFF;
  for (const b of new TextEncoder().encode(str)) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
}

// ---------- Frames ----------
/** Remove characters that would break a frame: pipes, newlines and other control characters. */
export function clean(s) {
  return String(s ?? '').replace(/\|/g, '/').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

export function encodeFrame(parts) {
  const body = parts.map(String).join('|');
  return `${body}|${crc32(body)}`;
}

/** Returns the parts (without checksum), or null if the checksum doesn't match. */
export function decodeFrame(text) {
  const s = String(text ?? '').trim();
  const cut = s.lastIndexOf('|');
  if (cut < 0) return null;
  const body = s.slice(0, cut);
  if (crc32(body) !== s.slice(cut + 1).toLowerCase()) return null;
  return body.split('|');
}

/** 'record' | 'config' | 'schedule' | null — what kind of code was scanned (by prefix only). */
export function identifyCode(text) {
  const tag = String(text ?? '').split('|', 1)[0];
  return { W: 'record', WCFG: 'config', WSCH: 'schedule' }[tag] || null;
}

// ---------- Field value encoding ----------
function encodeValue(f, v) {
  switch (f.type) {
    case 'bool': return v ? '1' : '0';
    case 'counter':
    case 'multi': return String(Math.max(0, Math.floor(Number(v) || 0)));
    case 'enum':
    case 'rating': return v === null || v === undefined ? '' : String(v);
    case 'text': return clean(v).slice(0, f.maxLength);
  }
  throw new Error(`Unknown field type ${f.type}`);
}

/** Parses one value; returns undefined if invalid. */
function decodeValue(f, s) {
  const isInt = /^\d{1,4}$/.test(s);
  switch (f.type) {
    case 'bool': return s === '1' ? true : s === '0' ? false : undefined;
    case 'counter': return isInt ? Number(s) : undefined;
    case 'multi': return isInt && Number(s) < (1 << f.options.length) ? Number(s) : undefined;
    case 'enum':
      if (s === '') return null;
      return isInt && Number(s) < f.options.length ? Number(s) : undefined;
    case 'rating':
      if (s === '') return null;
      return isInt && Number(s) >= 1 && Number(s) <= f.max ? Number(s) : undefined;
    case 'text': return s.length <= f.maxLength ? s : undefined;
  }
  return undefined;
}

// ---------- Records ----------
export const EVENT_RE = /^[a-z0-9]{3,16}$/;
export const SCOUT_ID_RE = /^[A-Za-z0-9_-]{1,12}$/;

/**
 * rec: { app_version, event, match_key, team, scout_id, station, ts, values }
 * ts is Unix seconds.
 */
export function encodeRecord(rec) {
  return encodeFrame([
    RECORD_TAG, clean(rec.app_version), SCHEMA_VERSION,
    rec.event, rec.match_key, rec.team, rec.scout_id, rec.station, rec.ts,
    ...FIELDS.map(f => encodeValue(f, rec.values[f.key])),
  ]);
}

/**
 * Returns { ok: true, record } or { ok: false, reason } with a reason a
 * human at the scan station can act on.
 * Options: { event } — if given, records from any other event are rejected.
 */
export function decodeRecord(text, opts = {}) {
  if (identifyCode(text) !== 'record') return { ok: false, reason: 'Not a match record QR code' };
  const parts = decodeFrame(text);
  if (!parts) return { ok: false, reason: 'Checksum failed — garbled scan, try again' };

  const [, app_version, schema, event, match_key, team, scout_id, station, ts] = parts;
  if (Number(schema) !== SCHEMA_VERSION) {
    return { ok: false, reason: `Form version mismatch: iPad has v${schema}, laptop expects v${SCHEMA_VERSION}. Update the iPad app.` };
  }
  if (parts.length !== HEADER_LEN + FIELDS.length) {
    return { ok: false, reason: `Wrong number of fields (${parts.length - HEADER_LEN}, expected ${FIELDS.length})` };
  }
  if (!EVENT_RE.test(event)) return { ok: false, reason: `Bad event code "${event}"` };
  if (opts.event && event !== opts.event) {
    return { ok: false, reason: `Wrong event: record is for ${event}, laptop is set to ${opts.event}` };
  }
  if (!parseMatchKey(match_key)) return { ok: false, reason: `Bad match key "${match_key}"` };
  if (!/^\d{1,5}$/.test(team) || Number(team) < 1) return { ok: false, reason: `Bad team number "${team}"` };
  if (!SCOUT_ID_RE.test(scout_id)) return { ok: false, reason: `Bad scout ID "${scout_id}"` };
  if (!STATIONS.includes(station)) return { ok: false, reason: `Bad station "${station}"` };
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, reason: `Bad timestamp "${ts}"` };

  const values = {};
  for (let i = 0; i < FIELDS.length; i++) {
    const f = FIELDS[i];
    const v = decodeValue(f, parts[HEADER_LEN + i]);
    if (v === undefined) return { ok: false, reason: `Bad value for ${f.key}: "${parts[HEADER_LEN + i]}"` };
    values[f.key] = v;
  }

  return {
    ok: true,
    record: {
      app_version, schema_version: SCHEMA_VERSION, event, match_key,
      team: Number(team), scout_id, station, ts: Number(ts), values,
    },
  };
}

/**
 * Record identity: match + team + scout. A newer record with the same key
 * supersedes an older one (correction); two scouts on one robot are both kept.
 */
export function recordKey(rec) {
  return `${rec.match_key}|${rec.team}|${rec.scout_id}`;
}
