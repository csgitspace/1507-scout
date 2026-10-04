// ==============================================================================
// Warlocks 1507 Scouting App — v3 Source of Truth (Blank Sheet / New Project)
// Optimized for: fewer roundtrips, caching, client-side match lookup
// ==============================================================================

// --------------------
// 1) CONSTANTS / SHEETS
// --------------------
const TBA_KEY = PropertiesService.getScriptProperties().getProperty('TBA_KEY');

const S_CONFIG      = 'Config';
const S_TEAMS       = 'Teams';
const S_MATCHES     = 'Matches';
const S_PIT         = 'PitData';
const S_MATCH       = 'MatchData';
const S_SCOUTS      = 'Scouts';
const S_FAVORITES   = 'Favorites';
const S_ASSIGNMENTS = 'Assignments';

const PHOTO_FOLDER_NAME = "FRC_Pit_Photos";

// Cache keys
const CACHE_EVENT_INDEX = 'eventIndex_v3';
const CACHE_EVENT_NAME_PREFIX = 'eventName_v3_'; // + eventKey
const CACHE_TBA_TEAM_PREFIX = 'tbaTeam_v3_';     // + teamNumber

// --------------------
// 2) SERVE THE APP
// --------------------
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Warlocks 1507 Scouting')
    .setFaviconUrl('https://www.thebluealliance.com/favicon.ico')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=0');
}

// ==============================================================================
// HELPERS: Sheets / Headers / Locks / Caching
// ==============================================================================
function getSheet_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  return sh;
}

function ensureHeaders_(sheet, headers) {
  const lastCol = Math.max(sheet.getLastColumn(), headers.length);
  const row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const anyHeaderText = row.some(v => String(v || '').trim() !== '');
  if (!anyHeaderText) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
}

function headerMap_(sheet) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  headers.forEach((h, i) => map[String(h).trim()] = i);
  return map;
}

function withDocLock_(fn) {
  const lock = LockService.getDocumentLock();
  lock.waitLock(15000);
  try {
    return fn();
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }
}

function _toIntSafe_(v, fallback) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && !Number.isNaN(n) ? n : fallback;
}

function safeAppend_(sheetName, row) {
  return withDocLock_(() => {
    const sh = getSheet_(sheetName);
    sh.appendRow(row);
    return { action: 'append' };
  });
}

/**
 * Update row where matchCol equals matchValue; else append
 * matchColIndex0 is 0-based.
 */
function safeUpdateOrAppend_(sheetName, matchColIndex0, matchValue, row) {
  return withDocLock_(() => {
    const sh = getSheet_(sheetName);
    const lastRow = sh.getLastRow();
    if (lastRow < 2) {
      sh.appendRow(row);
      return { action: "append" };
    }
    const col = sh.getRange(2, matchColIndex0 + 1, lastRow - 1, 1).getValues().flat();
    const idx = col.findIndex(v => String(v) === String(matchValue));
    if (idx >= 0) {
      sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
      return { action: "update" };
    }
    sh.appendRow(row);
    return { action: "append" };
  });
}

// ==============================================================================
// TBA API
// ==============================================================================
function fetchTBA_(endpoint) {
  if (!TBA_KEY) throw new Error("Missing TBA_KEY in Script Properties.");
  const url = `https://www.thebluealliance.com/api/v3${endpoint}`;
  const res = UrlFetchApp.fetch(url, {
    headers: { 'X-TBA-Auth-Key': TBA_KEY },
    muteHttpExceptions: true
  });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error(`TBA Error: ${code}`);
  return JSON.parse(res.getContentText());
}

// ==============================================================================
// BOOTSTRAP: Sheets + Config
// ==============================================================================
function ensureBaseSheets_() {
  // Config (key/value)
  const cfg = getSheet_(S_CONFIG);
  ensureHeaders_(cfg, ['key', 'value']);

  // Teams / Matches
  const t = getSheet_(S_TEAMS);    ensureHeaders_(t, ['team_number', 'team_name', 'city', 'state_prov', 'country']);
  const m = getSheet_(S_MATCHES);  ensureHeaders_(m, ['match_key', 'comp_level', 'match_number', 'red1', 'red2', 'red3', 'blue1', 'blue2', 'blue3']);

  // Pit (simplified notes)
  const p = getSheet_(S_PIT);
  ensureHeaders_(p, [
    'timestamp','scout_id','scout_name',
    'team_number','team_name',
    'robot_photo_url',
    'drive_type','starting_position','auto_description','climb_during_auto',
    'climber_capability','climb_location','num_shooters','vision_capability','under_trench','turret_shooter',
    'hopper_capacity_fuel','jam_risk','fuel_acquisition','primary_role',
    'favorite','overall_rank',
    'pit_notes'
  ]);

  // Match
  const md = getSheet_(S_MATCH);
  ensureHeaders_(md, [
    'timestamp','scout_id','scout_name','event_key',
    'match_key','comp_level','match_number',
    'alliance','station','team_number',
    'auto_dead','auto_start_position','auto_fuel_hub','auto_climb',
    'teleop_fuel_hub_scored','teleop_fuel_hub_missed',
    'cycle_speed','primary_role','fuel_pickup_source',
    'endgame_attempt','endgame_level','notes',
    'unique_key'
  ]);

  // Scouts / Favorites / Assignments
  const s = getSheet_(S_SCOUTS); ensureHeaders_(s, ['scout_id','scout_name','created_at','last_seen']);
  const f = getSheet_(S_FAVORITES); ensureHeaders_(f, ['scout_id','team_number','created_at']);
  const a = getSheet_(S_ASSIGNMENTS); ensureHeaders_(a, ['scout_id','match_key','comp_level','match_number','team_number','created_at','notes']);
}

function getAppConfig() {
  ensureBaseSheets_();
  const sh = getSheet_(S_CONFIG);

  // Key/value only (no legacy)
  const data = sh.getDataRange().getValues(); // includes header
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const k = String(data[i][0] || '').trim();
    const v = String(data[i][1] || '').trim();
    if (k) map[k] = v;
  }

  const eventKey = String(map.event_key || '').trim();
  const lastSync = String(map.last_sync || '').trim();

  if (lastSync === "PRACTICE MODE") {
    return { eventKey, eventName: "PRACTICE MODE", lastSync };
  }

  let eventName = eventKey ? "Loading Event..." : "Event Not Configured (Config sheet)";
  if (eventKey) {
    const cache = CacheService.getScriptCache();
    const cachedName = cache.get(CACHE_EVENT_NAME_PREFIX + eventKey);
    if (cachedName) {
      eventName = cachedName;
    } else {
      try {
        const ev = fetchTBA_(`/event/${eventKey}`);
        if (ev?.name) {
          eventName = ev.name;
          cache.put(CACHE_EVENT_NAME_PREFIX + eventKey, eventName, 21600); // 6 hours
        }
      } catch (e) {
        Logger.log(e);
        eventName = "Event (TBA lookup failed)";
      }
    }
  }

  return { eventKey, eventName, lastSync };
}

// ==============================================================================
// ADMIN: Sync Event + Practice Mode
// ==============================================================================
function adminInitialize() {
  ensureBaseSheets_();
  const cfg = getSheet_(S_CONFIG);

  const eventKey = String(_kvGet_(cfg, 'event_key') || '').trim();
  if (!eventKey) throw new Error("Please set event_key in Config sheet.");

  const teams = fetchTBA_(`/event/${eventKey}/teams/simple`);
  const matches = fetchTBA_(`/event/${eventKey}/matches/simple`);

  _kvSet_(cfg, 'event_key', eventKey);
  _kvSet_(cfg, 'last_sync', new Date().toISOString());

  // Teams
  const tSheet = getSheet_(S_TEAMS);
  tSheet.clear();
  const tHeaders = ['team_number','team_name','city','state_prov','country'];
  tSheet.getRange(1, 1, 1, tHeaders.length).setValues([tHeaders]);
  const tRows = (teams || []).map(t => [t.team_number, t.nickname, t.city, t.state_prov, t.country]);
  if (tRows.length) tSheet.getRange(2, 1, tRows.length, tRows[0].length).setValues(tRows);

  // Matches
  const mSheet = getSheet_(S_MATCHES);
  mSheet.clear();
  const mHeaders = ['match_key','comp_level','match_number','red1','red2','red3','blue1','blue2','blue3'];
  mSheet.getRange(1, 1, 1, mHeaders.length).setValues([mHeaders]);

  const mRows = [];
  (matches || []).forEach(m => {
    if (m?.alliances?.red?.team_keys?.length >= 3 && m?.alliances?.blue?.team_keys?.length >= 3) {
      const red = m.alliances.red.team_keys.map(k => k.replace('frc',''));
      const blue = m.alliances.blue.team_keys.map(k => k.replace('frc',''));
      mRows.push([m.key, m.comp_level, m.match_number, red[0], red[1], red[2], blue[0], blue[1], blue[2]]);
    }
  });
  if (mRows.length) mSheet.getRange(2, 1, mRows.length, mRows[0].length).setValues(mRows);

  // Clear caches
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_EVENT_INDEX);
  cache.remove(CACHE_EVENT_NAME_PREFIX + eventKey);

  return `Success! Synced ${teams.length} teams and ${mRows.length} matches.`;
}

function adminPracticeMode() {
  ensureBaseSheets_();
  const cfg = getSheet_(S_CONFIG);

  const eventKey = String(_kvGet_(cfg, 'event_key') || '').trim();
  if (!eventKey) throw new Error("Please set event_key in Config sheet.");

  const teams = fetchTBA_(`/event/${eventKey}/teams/simple`);
  if (!teams?.length) throw new Error("Could not find teams for this event.");

  _kvSet_(cfg, 'event_key', eventKey);
  _kvSet_(cfg, 'last_sync', 'PRACTICE MODE');

  // Teams
  const tSheet = getSheet_(S_TEAMS);
  tSheet.clear();
  const tHeaders = ['team_number','team_name','city','state_prov','country'];
  tSheet.getRange(1, 1, 1, tHeaders.length).setValues([tHeaders]);
  const tRows = teams.map(t => [t.team_number, t.nickname, t.city, t.state_prov, t.country]);
  if (tRows.length) tSheet.getRange(2, 1, tRows.length, tRows[0].length).setValues(tRows);

  // Dummy matches
  const teamNums = teams.map(t => t.team_number);
  const mSheet = getSheet_(S_MATCHES);
  mSheet.clear();
  const mHeaders = ['match_key','comp_level','match_number','red1','red2','red3','blue1','blue2','blue3'];
  mSheet.getRange(1, 1, 1, mHeaders.length).setValues([mHeaders]);

  const numMatches = 20;
  const mRows = [];
  for (let i = 1; i <= numMatches; i++) {
    const shuffled = [...teamNums].sort(() => 0.5 - Math.random());
    const selected = shuffled.slice(0, 6);
    mRows.push([`${eventKey}_qm${i}`, 'qm', i, selected[0], selected[1], selected[2], selected[3], selected[4], selected[5]]);
  }
  mSheet.getRange(2, 1, mRows.length, mRows[0].length).setValues(mRows);

  // Clear caches
  const cache = CacheService.getScriptCache();
  cache.remove(CACHE_EVENT_INDEX);
  cache.remove(CACHE_EVENT_NAME_PREFIX + eventKey);

  return `Practice Mode configured! Synced ${teams.length} teams and generated ${numMatches} dummy matches.`;
}

function _kvGet_(sheet, key) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][0] || '').trim() === key) return data[i][1];
  }
  return '';
}

function _kvSet_(sheet, key, value) {
  return withDocLock_(() => {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][0] || '').trim() === key) {
        sheet.getRange(i + 1, 2).setValue(value);
        return;
      }
    }
    sheet.appendRow([key, value]);
  });
}

// ==============================================================================
// MATCH LOOKUP (server builds index once; client uses payload)
// ==============================================================================
function getEventIndex_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(CACHE_EVENT_INDEX);
  if (cached) return JSON.parse(cached);

  const sh = getSheet_(S_MATCHES);
  const data = sh.getDataRange().getValues(); // header + rows

  const index = {}; // "qm_12" => { red:[...], blue:[...], match_key:"..." }
  for (let i = 1; i < data.length; i++) {
    const comp = String(data[i][1] || '').trim();
    const num  = String(data[i][2] || '').trim();
    if (!comp || !num) continue;
    const key = `${comp}_${num}`;
    index[key] = {
      match_key: data[i][0],
      red:  [String(data[i][3]||''), String(data[i][4]||''), String(data[i][5]||'')].filter(Boolean),
      blue: [String(data[i][6]||''), String(data[i][7]||''), String(data[i][8]||'')].filter(Boolean)
    };
  }

  cache.put(CACHE_EVENT_INDEX, JSON.stringify(index), 21600); // 6 hours
  return index;
}

// ==============================================================================
// PIT: TBA helper (cached per team)
// ==============================================================================
function fetchPitTeamInfo(teamNumber) {
  if (!teamNumber) return { error: "No team number provided." };
  teamNumber = String(teamNumber).trim();

  // Cache (6 hours)
  const cache = CacheService.getScriptCache();
  const key = CACHE_TBA_TEAM_PREFIX + teamNumber;
  const cached = cache.get(key);
  if (cached) return JSON.parse(cached);

  const cfg = getAppConfig();
  let eventYear = new Date().getFullYear();
  if (cfg.eventKey && String(cfg.eventKey).length >= 4) {
    const y = Number(String(cfg.eventKey).slice(0, 4));
    if (!Number.isNaN(y)) eventYear = y;
  }
  const awardsYear = eventYear - 1;

  try {
    const team = fetchTBA_(`/team/frc${teamNumber}`);
    const awards = fetchTBA_(`/team/frc${teamNumber}/awards/${awardsYear}`);
    let awardStr = "No awards recorded for last year.";
    if (awards?.length) awardStr = awards.map(a => a.name).join(", ");

    const out = {
      team_name: team.nickname || "Unknown",
      hometown: `${team.city || ''}${team.state_prov ? ', ' + team.state_prov : ''}`.trim() || "Unknown",
      past_awards: awardStr
    };
    cache.put(key, JSON.stringify(out), 21600);
    return out;
  } catch (e) {
    return { error: "Could not fetch data. Check team number or API key.", team_name: "Unknown", hometown: "Unknown", past_awards: "Unknown" };
  }
}

// ==============================================================================
// MATCH SUBMISSION (de-dupe)
// ==============================================================================
function submitMatchReport(p) {
  ensureBaseSheets_();

  const sh = getSheet_(S_MATCH);
  const idx = headerMap_(sh);

  const matchKey = String(p.match_key || '').trim();
  const teamNum  = String(p.team_number || '').trim();
  const uniqueKey = `${matchKey}_${teamNum}`;

  const teleopScored = Number(p.teleop_fuel_hub_scored ?? 0);
  const teleopMissed = Number(p.teleop_fuel_hub_missed ?? 0);

  const alliance = String(p.alliance || '').trim().toLowerCase();
  const station  = _toIntSafe_(p.station, 1);

  const row = [
    new Date().toISOString(),
    String(p.scout_id || '').trim(),
    p.scout_name || "Unknown",
    p.event_key || "",

    matchKey,
    p.comp_level || "",
    p.match_number || "",

    alliance,
    station,
    teamNum,

    !!p.auto_dead,
    p.auto_start_position || "",
    Number(p.auto_fuel_hub || 0),
    !!p.auto_climb,

    teleopScored,
    teleopMissed,

    String(p.cycle_speed || ''),
    p.primary_role || "",
    p.fuel_pickup_source || "",

    !!p.endgame_attempt,
    p.endgame_level || "",
    p.notes || "",

    uniqueKey
  ];

  const uniqueCol0 = idx['unique_key'];
  if (uniqueCol0 === undefined) {
    safeAppend_(S_MATCH, row);
    return { action: "append" };
  }
  return safeUpdateOrAppend_(S_MATCH, uniqueCol0, uniqueKey, row);
}

// ==============================================================================
// PIT SUBMISSION (Drive image overwrite by filename)
// ==============================================================================
function submitPitReport(p, overwrite) {
  ensureBaseSheets_();

  const sh = getSheet_(S_PIT);
  const idx = headerMap_(sh);

  const teamNumber = String(p.team_number || '').trim();

  // Photo upload (reuse filename per team)
  let photoUrl = '';
  if (p.image_base64) {
    try {
      const base64Data = String(p.image_base64).split(',')[1];
      const blob = Utilities.newBlob(
        Utilities.base64Decode(base64Data),
        'image/jpeg',
        `${teamNumber}_pit.jpg`
      );

      const folders = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME);
      const folder = folders.hasNext() ? folders.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);

      const existing = folder.getFilesByName(`${teamNumber}_pit.jpg`);
      while (existing.hasNext()) {
        const f = existing.next();
        try { f.setTrashed(true); } catch (e) {}
      }

      const file = folder.createFile(blob);
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      photoUrl = `https://drive.google.com/thumbnail?id=${file.getId()}&sz=w800`;
    } catch (e) {
      photoUrl = '';
    }
  }

  const row = [
    new Date().toISOString(),
    String(p.scout_id || '').trim(),
    p.scout_name || "Unknown",

    teamNumber,
    p.team_name || "Unknown",

    photoUrl || "",

    p.drive_type || "",
    p.starting_position || "",
    p.auto_description || "",
    p.climb_during_auto ?? "",

    p.climber_capability || "",
    p.climb_location || "",
    p.num_shooters ?? "",
    p.vision_capability || "",
    p.under_trench || "",
    p.turret_shooter ?? "",

    p.hopper_capacity_fuel ?? "",
    p.jam_risk || "",
    p.fuel_acquisition || "",
    p.primary_role || "",

    !!p.favorite,
    p.overall_rank ?? "",

    p.pit_notes || ""
  ];

  // Overwrite by team_number
  if (overwrite) {
    return withDocLock_(() => {
      const lastRow = sh.getLastRow();
      if (lastRow < 2) {
        sh.appendRow(row);
        return { action: "append" };
      }

      const teamCol0  = idx['team_number'];
      const photoCol0 = idx['robot_photo_url'];
      const teamVals = sh.getRange(2, teamCol0 + 1, lastRow - 1, 1).getValues().flat();
      const found = teamVals.findIndex(v => String(v).trim() === teamNumber);

      if (found >= 0) {
        // Preserve existing photo if no new photo
        if (!row[photoCol0] && photoCol0 !== undefined) {
          row[photoCol0] = sh.getRange(found + 2, photoCol0 + 1).getValue() || "";
        }
        sh.getRange(found + 2, 1, 1, row.length).setValues([row]);
        return { action: "update" };
      }

      sh.appendRow(row);
      return { action: "append" };
    });
  }

  return safeAppend_(S_PIT, row);
}

function checkPitExists(teamNumber) {
  ensureBaseSheets_();
  const sh = getSheet_(S_PIT);
  if (sh.getLastRow() < 2) return false;
  const idx = headerMap_(sh);
  const teamCol0 = idx['team_number'];
  const col = sh.getRange(2, teamCol0 + 1, sh.getLastRow() - 1, 1).getValues().flat();
  return col.some(v => String(v).trim() === String(teamNumber).trim());
}

// ==============================================================================
// REVIEW & COMPARE (Decision-first, includes pit_notes under notes)
// ==============================================================================
function getBotSummary(teamNumber) {
  ensureBaseSheets_();
  if (!teamNumber) throw new Error("Please enter a team number.");
  teamNumber = String(teamNumber).trim();

  // TBA cache (6 hours)
  const cache = CacheService.getScriptCache();
  const tbaKey = `tba_summary_v3_${teamNumber}`;
  let tbaInfo = cache.get(tbaKey);
  if (tbaInfo) tbaInfo = JSON.parse(tbaInfo);
  else {
    tbaInfo = fetchPitTeamInfo(teamNumber);
    cache.put(tbaKey, JSON.stringify(tbaInfo), 21600);
  }

  // Latest PIT row
  const pit = {};
  let pitNotes = '';
  const pSheet = getSheet_(S_PIT);
  if (pSheet.getLastRow() >= 2) {
    const pIdx = headerMap_(pSheet);
    const data = pSheet.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][pIdx.team_number]).trim() === teamNumber) {
        Object.keys(pIdx).forEach(h => pit[h] = data[i][pIdx[h]]);
        pitNotes = String(data[i][pIdx.pit_notes] || '').trim();
        break;
      }
    }
  }

  // MATCH stats + reliability + trends
  const mSheet = getSheet_(S_MATCH);
  let matches = 0, totalFuel = 0, missedFuel = 0, autoFuel = 0;

  let deadCount = 0;
  let autoClimbCount = 0;
  let endClimbCount = 0;
  let anyClimbCount = 0;

  const matchNotes = [];
  const roleCounts = {};
  const speedBuckets = { Fast: 0, Average: 0, Slow: 0 };

  if (mSheet.getLastRow() >= 2) {
    const midx = headerMap_(mSheet);
    const mData = mSheet.getDataRange().getValues();

    for (let i = 1; i < mData.length; i++) {
      if (String(mData[i][midx.team_number]).trim() !== teamNumber) continue;

      matches++;
      autoFuel   += Number(mData[i][midx.auto_fuel_hub] || 0);
      totalFuel  += Number(mData[i][midx.teleop_fuel_hub_scored] || 0);
      missedFuel += Number(mData[i][midx.teleop_fuel_hub_missed] || 0);

      const isDead = String(mData[i][midx.auto_dead]).toLowerCase() === 'true';
      if (isDead) deadCount++;

      const didAutoClimb = String(mData[i][midx.auto_climb]).toLowerCase() === 'true';
      const didEndClimb  = String(mData[i][midx.endgame_attempt]).toLowerCase() === 'true';
      if (didAutoClimb) autoClimbCount++;
      if (didEndClimb) endClimbCount++;
      if (didAutoClimb || didEndClimb) anyClimbCount++;

      const note = mData[i][midx.notes];
      if (note) matchNotes.push({ match_number: mData[i][midx.match_number], text: String(note) });

      const role = String(mData[i][midx.primary_role] || '').trim();
      if (role) roleCounts[role] = (roleCounts[role] || 0) + 1;

      const raw = mData[i][midx.cycle_speed];
      const n = Number(raw);
      if (!Number.isNaN(n) && n >= 1 && n <= 5) {
        if (n >= 4) speedBuckets.Fast++;
        else if (n === 3) speedBuckets.Average++;
        else speedBuckets.Slow++;
      } else {
        const s = String(raw || '').toLowerCase();
        if (s.includes('fast')) speedBuckets.Fast++;
        else if (s.includes('avg') || s.includes('average')) speedBuckets.Average++;
        else if (s.includes('slow')) speedBuckets.Slow++;
      }
    }
  }

  const denom = totalFuel + missedFuel;
  const accuracy = denom > 0 ? (Math.round((totalFuel / denom) * 100) + '%') : '0%';

  const pct = (num, den) => den ? (Math.round((num / den) * 100) + '%') : '0%';

  function dominantLabel_(countsObj, mixedThresholdRatio) {
    const entries = Object.entries(countsObj).filter(([,v]) => Number(v) > 0);
    if (!entries.length) return '—';
    entries.sort((a,b) => b[1] - a[1]);
    const [topLabel, topCount] = entries[0];
    const total = entries.reduce((sum, [,v]) => sum + v, 0);
    const ratio = total ? (topCount / total) : 0;
    if (ratio < mixedThresholdRatio) return 'Mixed';
    return topLabel;
  }

  return {
    tba: tbaInfo,
    pit,
    pitNotes,
    stats: {
      matchesPlayed: matches,
      avgFuel: matches ? (totalFuel / matches).toFixed(1) : 0,
      avgMissed: matches ? (missedFuel / matches).toFixed(1) : 0,
      accuracy,
      avgAutoFuel: matches ? (autoFuel / matches).toFixed(1) : 0,

      deadRate: pct(deadCount, matches),
      autoClimbRate: pct(autoClimbCount, matches),
      endClimbRate: pct(endClimbCount, matches),
      climbRate: pct(anyClimbCount, matches)
    },
    trends: {
      role: dominantLabel_(roleCounts, 0.55),
      cycleSpeed: dominantLabel_(speedBuckets, 0.55)
    },
    matchNotes
  };
}

function getCompareData(team1, team2) {
  return { t1: getBotSummary(team1), t2: getBotSummary(team2) };
}

// ==============================================================================
// SCOUT PROFILE (Unique-name enforcement) + FAVORITES + ASSIGNMENTS
// ==============================================================================
function listScouts() {
  ensureBaseSheets_();
  const sh = getSheet_(S_SCOUTS);
  if (sh.getLastRow() < 2) return [];
  const idx = headerMap_(sh);
  const data = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    out.push({ scout_id: data[i][idx.scout_id], scout_name: data[i][idx.scout_name] });
  }
  out.sort((a,b) => String(a.scout_name).localeCompare(String(b.scout_name)));
  return out;
}

/**
 * Prevent duplicate profiles:
 * - If a scout name already exists (case-insensitive), return that existing scout_id
 * - Otherwise create a new one using provided scoutId
 */
function registerOrLookupScout(scoutId, scoutName) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();
  scoutName = String(scoutName || '').trim();
  if (!scoutName) throw new Error("Scout name is required.");

  const sh = getSheet_(S_SCOUTS);
  const idx = headerMap_(sh);
  const now = new Date().toISOString();

  return withDocLock_(() => {
    const lastRow = sh.getLastRow();
    const target = scoutName.toLowerCase();

    if (lastRow >= 2) {
      const names = sh.getRange(2, idx.scout_name + 1, lastRow - 1, 1).getValues().flat();
      for (let i = 0; i < names.length; i++) {
        if (String(names[i] || '').trim().toLowerCase() === target) {
          const existingId = sh.getRange(i + 2, idx.scout_id + 1).getValue();
          // update last_seen
          sh.getRange(i + 2, idx.last_seen + 1).setValue(now);
          return { scout_id: String(existingId), scout_name: scoutName, existed: true };
        }
      }
    }

    if (!scoutId) throw new Error("Missing scoutId.");
    sh.appendRow([scoutId, scoutName, now, now]);
    return { scout_id: scoutId, scout_name: scoutName, existed: false };
  });
}

function getScoutBootstrap(scoutId) {
  ensureBaseSheets_();
  const cfg = getAppConfig();
  const favorites = getFavoritesForScout(scoutId);
  const assignments = getAssignmentsForScout(scoutId);
  const scoutName = getScoutName_(scoutId);
  return { config: cfg, scout_id: scoutId, scout_name: scoutName, favorites, assignments };
}

function getScoutName_(scoutId) {
  const sh = getSheet_(S_SCOUTS);
  if (sh.getLastRow() < 2) return "";
  const idx = headerMap_(sh);
  const col = sh.getRange(2, idx.scout_id + 1, sh.getLastRow() - 1, 1).getValues().flat();
  const found = col.findIndex(v => String(v) === String(scoutId));
  if (found < 0) return "";
  return sh.getRange(found + 2, idx.scout_name + 1).getValue();
}

function getFavoritesForScout(scoutId) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();
  const sh = getSheet_(S_FAVORITES);
  if (sh.getLastRow() < 2) return [];
  const idx = headerMap_(sh);
  const data = sh.getDataRange().getValues();
  const favs = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx.scout_id]) === scoutId) favs.push(String(data[i][idx.team_number]));
  }
  return [...new Set(favs)].sort((a,b) => Number(a) - Number(b));
}

function addFavoriteForScout(scoutId, teamNumber) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();
  teamNumber = String(teamNumber || '').trim();
  if (!scoutId || !teamNumber) throw new Error("Missing scout or team.");

  return withDocLock_(() => {
    const sh = getSheet_(S_FAVORITES);
    const idx = headerMap_(sh);
    const now = new Date().toISOString();

    // prevent duplicates
    const lastRow = sh.getLastRow();
    if (lastRow >= 2) {
      const data = sh.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][idx.scout_id]) === scoutId && String(data[i][idx.team_number]) === teamNumber) {
          return getAllianceBoardData_();
        }
      }
    }
    sh.appendRow([scoutId, teamNumber, now]);
    return getAllianceBoardData_();
  });
}

function removeFavoriteForScout(scoutId, teamNumber) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();
  teamNumber = String(teamNumber || '').trim();

  return withDocLock_(() => {
    const sh = getSheet_(S_FAVORITES);
    if (sh.getLastRow() < 2) return getAllianceBoardData_();
    const idx = headerMap_(sh);
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][idx.scout_id]) === scoutId && String(data[i][idx.team_number]) === teamNumber) {
        sh.deleteRow(i + 1);
      }
    }
    return getAllianceBoardData_();
  });
}

function clearFavoritesForScout(scoutId) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();

  return withDocLock_(() => {
    const sh = getSheet_(S_FAVORITES);
    if (sh.getLastRow() < 2) return getAllianceBoardData_();
    const idx = headerMap_(sh);
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][idx.scout_id]) === scoutId) sh.deleteRow(i + 1);
    }
    return getAllianceBoardData_();
  });
}

function getAssignmentsForScout(scoutId) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();
  const sh = getSheet_(S_ASSIGNMENTS);
  if (sh.getLastRow() < 2) return [];
  const idx = headerMap_(sh);
  const data = sh.getDataRange().getValues();
  const out = [];
  for (let i = 1; i < data.length; i++) {
    if (String(data[i][idx.scout_id]) === scoutId) {
      out.push({
        match_key: data[i][idx.match_key],
        comp_level: data[i][idx.comp_level],
        match_number: data[i][idx.match_number],
        team_number: data[i][idx.team_number],
        notes: data[i][idx.notes] || ''
      });
    }
  }
  out.sort((a,b) => (String(a.comp_level).localeCompare(String(b.comp_level)) || Number(a.match_number) - Number(b.match_number)));
  return out;
}

function adminAssignMatchTeam(scoutId, matchKey, compLevel, matchNumber, teamNumber, notes) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();
  matchKey = String(matchKey || '').trim();
  compLevel = String(compLevel || '').trim();
  matchNumber = String(matchNumber || '').trim();
  teamNumber = String(teamNumber || '').trim();
  notes = String(notes || '').trim();

  if (!scoutId || !matchKey || !teamNumber) throw new Error("Missing assignment fields.");

  return withDocLock_(() => {
    const sh = getSheet_(S_ASSIGNMENTS);
    const idx = headerMap_(sh);
    const data = sh.getDataRange().getValues();
    const now = new Date().toISOString();

    // remove duplicates first
    for (let i = data.length - 1; i > 0; i--) {
      if (
        String(data[i][idx.scout_id]) === scoutId &&
        String(data[i][idx.match_key]) === matchKey &&
        String(data[i][idx.team_number]) === teamNumber
      ) {
        sh.deleteRow(i + 1);
      }
    }

    sh.appendRow([scoutId, matchKey, compLevel, matchNumber, teamNumber, now, notes]);
    return getAssignmentsForScout(scoutId);
  });
}

function adminClearAssignmentsForScout(scoutId) {
  ensureBaseSheets_();
  scoutId = String(scoutId || '').trim();

  return withDocLock_(() => {
    const sh = getSheet_(S_ASSIGNMENTS);
    if (sh.getLastRow() < 2) return [];
    const idx = headerMap_(sh);
    const data = sh.getDataRange().getValues();
    for (let i = data.length - 1; i > 0; i--) {
      if (String(data[i][idx.scout_id]) === scoutId) sh.deleteRow(i + 1);
    }
    return [];
  });
}

// ==============================================================================
// ALLIANCE BOARD DATA (master + per-scout)
// ==============================================================================
function getAllianceBoardData_() {
  ensureBaseSheets_();

  const scouts = listScouts(); // [{id,name}]
  const idToName = {};
  scouts.forEach(s => idToName[String(s.scout_id)] = String(s.scout_name));

  // favorites rows
  const fSheet = getSheet_(S_FAVORITES);
  const favIdx = headerMap_(fSheet);

  const teamToScouts = {}; // team -> [{id,name}]
  const scoutToTeams = {}; // scoutId -> [teams]

  if (fSheet.getLastRow() >= 2) {
    const fData = fSheet.getDataRange().getValues();
    for (let i = 1; i < fData.length; i++) {
      const sid = String(fData[i][favIdx.scout_id] || '').trim();
      const team = String(fData[i][favIdx.team_number] || '').trim();
      if (!sid || !team) continue;

      const name = idToName[sid] || 'Unknown';

      if (!teamToScouts[team]) teamToScouts[team] = [];
      // de-dupe within team
      if (!teamToScouts[team].some(x => x.scout_id === sid)) {
        teamToScouts[team].push({ scout_id: sid, scout_name: name });
      }

      if (!scoutToTeams[sid]) scoutToTeams[sid] = [];
      if (!scoutToTeams[sid].includes(team)) scoutToTeams[sid].push(team);
    }
  }

  // sort lists
  Object.keys(teamToScouts).forEach(t => teamToScouts[t].sort((a,b) => a.scout_name.localeCompare(b.scout_name)));
  Object.keys(scoutToTeams).forEach(sid => scoutToTeams[sid].sort((a,b) => Number(a) - Number(b)));

  const masterTeams = Object.keys(teamToScouts)
    .map(team => ({ team, count: teamToScouts[team].length, scouts: teamToScouts[team] }))
    .sort((a,b) => (b.count - a.count) || (Number(a.team) - Number(b.team)));

  const perScout = scouts.map(s => ({
    scout_id: s.scout_id,
    scout_name: s.scout_name,
    teams: scoutToTeams[String(s.scout_id)] || []
  }));

  return { masterTeams, perScout };
}

// ==============================================================================
// INITIAL PAYLOAD (single roundtrip on load)
// ==============================================================================
function getInitialPayload() {
  ensureBaseSheets_();
  const cfg = getAppConfig();

  // One server build of event index, then client uses locally
  const eventIndex = getEventIndex_();

  const scouts = listScouts();
  const allianceBoard = getAllianceBoardData_();

  return {
    config: cfg,
    eventIndex,
    scouts,
    allianceBoard,
    serverTime: new Date().toISOString()
  };
}
