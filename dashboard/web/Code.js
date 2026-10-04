// ==============================================================================
// Mentor dashboard — the pick list.
//
// Deployed as a web app that runs as THE MENTOR VIEWING IT. This script is
// bound to the scouting Sheet, so a mentor can only load data if the Sheet is
// shared with them. Sharing the Sheet IS the allow-list (docs/plans/m3).
// Give mentors Editor access so they can save tags, ranks and notes.
//
// Hard rule: this never writes scouting data (Raw/Summary). Mentor
// annotations live in their own tabs (Mentor, MentorPrivate, Config gaps).
// ==============================================================================

var OUR_TEAM = 1507;   // left off the pick list — we can't pick ourselves
var TAGS = ['', 'Target', 'Backup', 'Avoid'];
var NOTE_MAX = 1000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Warlocks 1507 Pick List')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Scouting Sheet not found.');
  return ss;
}

function me_() {
  return Session.getActiveUser().getEmail() || Session.getEffectiveUser().getEmail() || 'unknown';
}

function friendly_(fn) {
  try {
    return fn();
  } catch (err) {
    var msg = String(err && err.message || err);
    if (/permission|access|not have/i.test(msg)) {
      throw new Error('You don\'t have access to the scouting Sheet. Ask the scouting lead to share it with ' + me_() +
        ' (Editor, to save notes).');
    }
    throw err;
  }
}

function mentorSheet_(ss) {
  var sh = getOrCreateSheet_(ss, TAB.MENTOR);
  ensureHeaderColumns_(sh, MENTOR_HEADERS);
  return sh;
}

function privateSheet_(ss) {
  var sh = getOrCreateSheet_(ss, TAB.PRIVATE);
  ensureHeaderColumns_(sh, PRIVATE_HEADERS);
  return sh;
}

/** Everything the pick list screen needs, in one call. */
function getPickList() {
  return friendly_(function () {
    var ss = ss_();
    var me = me_();
    var cfg = kvGetAll_(ss);
    var gaps = cfg.gaps || [];
    var summary = ss.getSheetByName(TAB.SUMMARY);
    var teams = (summary ? readRows_(summary).map(rowToSummary_) : [])
      .filter(function (t) { return Number(t.team) !== OUR_TEAM; });

    var mentor = {};
    readObjects_(mentorSheet_(ss)).forEach(function (m) { mentor[m.team] = m; });
    var priv = {};
    readObjects_(privateSheet_(ss)).forEach(function (p) { if (p.email === me) priv[p.team] = p.note; });

    teams.forEach(function (t) {
      var fit = fitFor(t, gaps);
      t.fit = fit.fit; t.fit_score = fit.fit_score; t.fit_reason = fit.fit_reason;
      var m = mentor[t.team] || {};
      t.rank = m.rank === '' || m.rank === undefined ? null : Number(m.rank);
      t.tag = m.tag || '';
      t.shared_note = m.shared_note || '';
      t.shared_note_by = m.shared_note_by || '';
      t.shared_note_at = m.shared_note_at ? String(m.shared_note_at) : '';
      t.private_note = priv[t.team] || '';
    });
    teams.sort(function (a, b) {
      if (a.rank !== null && b.rank !== null) return a.rank - b.rank;
      if (a.rank !== null) return -1;
      if (b.rank !== null) return 1;
      return b.strength_score - a.strength_score || a.team - b.team;
    });

    return {
      me: me,
      now: Date.now(),
      lastSyncMs: cfg.last_sync_ms || null,
      event: cfg.event || '',
      eventName: cfg.event_name || '',
      gaps: gaps,
      gapDefs: DRAFT.gaps.map(function (g) { return { id: g.id, label: g.label }; }),
      teams: teams,
    };
  });
}

function checkTeam_(team) {
  var n = Number(team);
  if (!(n >= 1 && n <= 99999 && Math.floor(n) === n)) throw new Error('Bad team number');
  return n;
}

function saveTag(team, tag) {
  return friendly_(function () {
    team = checkTeam_(team);
    if (TAGS.indexOf(tag) < 0) throw new Error('Bad tag');
    var ss = ss_(), me = me_(), at = new Date().toISOString();
    withLock_(function () {
      upsertRow_(mentorSheet_(ss), MENTOR_HEADERS, { team: team }, { tag: tag, updated_by: me, updated_at: at });
    });
    return { ok: true };
  });
}

function saveSharedNote(team, note) {
  return friendly_(function () {
    team = checkTeam_(team);
    note = String(note || '').slice(0, NOTE_MAX);
    var ss = ss_(), me = me_(), at = new Date().toISOString();
    withLock_(function () {
      upsertRow_(mentorSheet_(ss), MENTOR_HEADERS, { team: team }, {
        shared_note: cellText_(note), shared_note_by: me, shared_note_at: at, updated_by: me, updated_at: at,
      });
    });
    return { ok: true, by: me, at: at };
  });
}

function savePrivateNote(team, note) {
  return friendly_(function () {
    team = checkTeam_(team);
    note = String(note || '').slice(0, NOTE_MAX);
    var ss = ss_(), me = me_();
    withLock_(function () {
      upsertRow_(privateSheet_(ss), PRIVATE_HEADERS, { email: me, team: team },
        { note: cellText_(note), updated_at: new Date().toISOString() });
    });
    return { ok: true };
  });
}

/** teams: team numbers in pick order. Teams not listed lose their rank. */
function saveRanking(teams) {
  return friendly_(function () {
    if (!Array.isArray(teams) || teams.length > 300) throw new Error('Bad ranking');
    teams = teams.map(checkTeam_);
    var ss = ss_(), me = me_(), at = new Date().toISOString();
    withLock_(function () {
      var sh = mentorSheet_(ss);
      var headers = readHeaders_(sh);
      var idx = headerIndex_(headers);
      var rows = readRows_(sh);
      var byTeam = {};
      rows.forEach(function (r) { byTeam[r[idx.team]] = r; });
      teams.forEach(function (t) {
        if (!byTeam[t]) { var r = headers.map(function () { return ''; }); r[idx.team] = t; rows.push(r); byTeam[t] = r; }
      });
      rows.forEach(function (r) {
        var pos = teams.indexOf(Number(r[idx.team]));
        var rank = pos >= 0 ? pos + 1 : '';
        if (r[idx.rank] !== rank) { r[idx.rank] = rank; r[idx.updated_by] = me; r[idx.updated_at] = at; }
      });
      writeTable_(sh, headers, rows.map(function (r) { return r.slice(0, headers.length); }));
    });
    return { ok: true };
  });
}

function saveGaps(ids) {
  return friendly_(function () {
    var valid = DRAFT.gaps.map(function (g) { return g.id; });
    ids = (Array.isArray(ids) ? ids : []).filter(function (id) { return valid.indexOf(id) >= 0; });
    kvSet_(ss_(), 'gaps', ids);
    return { ok: true, gaps: ids };
  });
}
