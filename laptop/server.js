// ==============================================================================
// Scan station — start with:  npm run station
//
// Opens http://localhost:1507 in the browser. Data lives in data/scout.sqlite
// (gitignored), with a backup copy in data/backups/ every 10 minutes when
// anything changed. Only this laptop can reach the server (127.0.0.1).
//
// Options:  --no-open (don't launch the browser)   PORT=1508   SCOUT_DATA=D:\scouting
// ==============================================================================

import { createServer } from 'node:http';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { openDb } from './db.js';
import { createHandler } from './api.js';
import { createSync } from './sync.js';
import { createTokenSource } from './google-auth.js';

const PORT = Number(process.env.PORT) || 1507;
const DATA = process.env.SCOUT_DATA || fileURLToPath(new URL('../data/', import.meta.url));
const BACKUPS = join(DATA, 'backups');
const KEEP_BACKUPS = 48; // 8 hours of 10-minute backups

mkdirSync(BACKUPS, { recursive: true });
const store = openDb(join(DATA, 'scout.sqlite'));

// ---- Backups: copy the database every 10 minutes if the scan count changed ----
let lastBackupScans = -1;
function backup() {
  const { scans } = store.counts(store.getSetting('event') || '');
  if (scans === lastBackupScans) return;
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 16);
  try {
    store.backupTo(join(BACKUPS, `scout-${stamp}.sqlite`));
    lastBackupScans = scans;
    const old = readdirSync(BACKUPS).filter(f => f.endsWith('.sqlite')).sort().slice(0, -KEEP_BACKUPS);
    for (const f of old) unlinkSync(join(BACKUPS, f));
  } catch (err) {
    console.error('Backup failed:', err.message);
  }
}
setInterval(backup, 10 * 60 * 1000);

// ---- Dashboard sync: every 3 minutes (mentors' freshness bar is 10) ----
const SYNC_MINUTES = Number(process.env.SYNC_MINUTES) || 3;
const tokenSource = createTokenSource(join(DATA, 'google-auth.json'));   // from `npm run station:login`
const sync = createSync({ store, dashboardFile: join(DATA, 'dashboard.json'), tokenSource });
const runSync = () => sync.syncOnce().then(s => {
  if (s.lastError && s.configured) console.log(`Sync failed: ${s.lastError} (${s.pending} waiting)`);
});
setTimeout(runSync, 15 * 1000);
setInterval(runSync, SYNC_MINUTES * 60 * 1000);

const server = createServer(createHandler({ store, sync }));
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is busy — is the scan station already running? Close it or set PORT.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`⚡ Warlocks 1507 scan station running at ${url}`);
  console.log(`   Data: ${DATA}`);
  console.log('   Press Ctrl+C to stop.');
  if (!process.argv.includes('--no-open')) {
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  }
});

function shutdown() {
  backup();
  store.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
