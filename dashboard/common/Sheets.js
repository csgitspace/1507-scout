// ==============================================================================
// Google Sheet helpers shared by the sync endpoint and the dashboard.
// Adapted from legacy Code.gs (getSheet_, ensureHeaders_, headerMap_, withDocLock_).
// ==============================================================================

var TAB = {
  RAW: 'Raw',               // every synced record version — written only by the sync endpoint
  SUMMARY: 'Summary',       // one row per team, rebuilt on every sync
  TEAMS: 'Teams',           // from the laptop's TBA import
  MATCHES: 'Matches',       // schedule, from the laptop
  // (Tab names say "Mentor" for history; they hold the pick team's data — mentors and student leads.)
  MENTOR: 'Mentor',         // OFFICIAL rank / tag / shared note — written only by the dashboard, only for pick leads
  PRIVATE: 'MentorPrivate', // private notes per person — written only by the dashboard
  MYPICKS: 'MyPicks',       // each person's own practice pick list (rank / tag) — never affects the official list
  LEADS: 'Leads',           // emails allowed to change the official list — edited by the team account only
  CONFIG: 'Config',         // key / value: last sync, event, our robot's gaps, data health
  EXTERNAL: 'External',     // per team: Statbotics EPA, TBA OPR + rank — reference data, never scouting data
  RESULTS: 'Results',       // per played match: TBA scores
};

var MENTOR_HEADERS = ['team', 'rank', 'tag', 'shared_note', 'shared_note_by', 'shared_note_at', 'updated_by', 'updated_at', 'picked'];
var PRIVATE_HEADERS = ['email', 'team', 'note', 'updated_at'];
var MYPICKS_HEADERS = ['email', 'team', 'rank', 'tag', 'updated_at'];
var LEADS_HEADERS = ['email', 'name', 'role'];
var EXTERNAL_COLUMNS = ['team', 'epa', 'epa_auto', 'epa_teleop', 'epa_endgame', 'epa_fuel', 'epa_tower', 'epa_source',
  'opr', 'rank', 'record', 'rp_avg'];
var RESULTS_COLUMNS = ['match_key', 'match', 'red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3', 'red_score', 'blue_score', 'winner', 'played_at'];

/**
 * Text typed by people (scout notes, mentor notes, names) must never become a
 * formula: Sheets treats "=..." / "+..." / "-..." / "@..." as one. A leading
 * apostrophe makes Sheets store it as plain text.
 */
function cellText_(v) {
  return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v;
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

/** All rows below the header, as arrays. */
function readRows_(sheet) {
  var lastRow = sheet.getLastRow(), lastCol = sheet.getLastColumn();
  if (lastRow < 2 || lastCol < 1) return [];
  return sheet.getRange(2, 1, lastRow - 1, lastCol).getValues();
}

function readHeaders_(sheet) {
  var lastCol = sheet.getLastColumn();
  if (lastCol < 1 || sheet.getLastRow() < 1) return [];
  return sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); });
}

/** { header: columnIndex0 } */
function headerIndex_(headers) {
  var map = {};
  headers.forEach(function (h, i) { if (h) map[h] = i; });
  return map;
}

/**
 * Makes sure every wanted header exists. Missing ones are added at the END,
 * so existing data never shifts columns. Returns the full header list.
 */
function ensureHeaderColumns_(sheet, wanted) {
  var headers = readHeaders_(sheet);
  var missing = wanted.filter(function (h) { return headers.indexOf(h) < 0; });
  if (!missing.length) return headers;
  var start = headers.length + 1;
  sheet.getRange(1, start, 1, missing.length).setValues([missing]);
  if (sheet.setFrozenRows) sheet.setFrozenRows(1);
  return headers.concat(missing);
}

/** Replaces a whole sheet's contents with headers + rows. */
function writeTable_(sheet, headers, rows) {
  sheet.clearContents();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  if (sheet.setFrozenRows) sheet.setFrozenRows(1);
}

/**
 * { headers, rows } in ONE Sheets call (getDataRange), for read paths where
 * speed matters. rows are the arrays below the header.
 */
function readTable_(sheet) {
  var values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], rows: [] };
  return { headers: values[0].map(function (h) { return String(h).trim(); }), rows: values.slice(1) };
}

/** Rows of a sheet as objects keyed by header. */
function readObjects_(sheet) {
  var t = readTable_(sheet);
  return t.rows.map(function (row) {
    var o = {};
    t.headers.forEach(function (h, i) { if (h) o[h] = row[i]; });
    return o;
  });
}

/** readObjects_ of a tab by name, or [] if the tab doesn't exist yet. Never creates it. */
function readTab_(ss, name) {
  var sh = ss.getSheetByName(name);
  return sh ? readObjects_(sh) : [];
}

/**
 * Update the first row whose key columns match, or append a new one.
 * keys / updates are { header: value }. Only the given columns change.
 */
function upsertRow_(sheet, headers, keys, updates) {
  var idx = headerIndex_(headers);
  var rows = readRows_(sheet);
  var keyNames = Object.keys(keys);
  var found = -1;
  for (var i = 0; i < rows.length; i++) {
    if (keyNames.every(function (k) { return String(rows[i][idx[k]]) === String(keys[k]); })) { found = i; break; }
  }
  var row = found >= 0 ? rows[found].slice() : headers.map(function () { return ''; });
  while (row.length < headers.length) row.push('');
  var all = Object.assign({}, keys, updates);
  Object.keys(all).forEach(function (k) { if (idx[k] !== undefined) row[idx[k]] = all[k]; });
  var rowNumber = found >= 0 ? found + 2 : Math.max(sheet.getLastRow(), 1) + 1;
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([row.slice(0, headers.length)]);
}

// ---------- Config tab (key / value, values stored as JSON) ----------
function configSheet_(ss) {
  var sh = getOrCreateSheet_(ss, TAB.CONFIG);
  ensureHeaderColumns_(sh, ['key', 'value']);
  return sh;
}
/** Read-only: doesn't create the Config tab (every page load calls this). */
function kvGetAll_(ss) {
  var out = {};
  var sh = ss.getSheetByName(TAB.CONFIG);
  if (!sh) return out;
  readTable_(sh).rows.forEach(function (r) {
    if (!r[0]) return;
    try { out[r[0]] = JSON.parse(r[1]); } catch (e) { out[r[0]] = r[1]; }
  });
  return out;
}
function kvSet_(ss, key, value) {
  var sh = configSheet_(ss);
  upsertRow_(sh, ['key', 'value'], { key: key }, { value: JSON.stringify(value) });
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { try { lock.releaseLock(); } catch (e) { /* already released */ } }
}

/** Only the sheet's owner (the sync endpoint's account) may edit this tab. */
function protectOwnerOnly_(sheet, description) {
  if (!sheet.protect) return;
  var existing = sheet.getProtections ? sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET) : [];
  if (existing && existing.length) return;
  var p = sheet.protect().setDescription(description);
  p.removeEditors(p.getEditors());
  if (p.canDomainEdit()) p.setDomainEdit(false);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
