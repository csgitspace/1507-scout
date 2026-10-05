// ==============================================================================
// npm run station:login — signs this laptop in to Google for the dashboard sync.
//
// One time per laptop, signed in as a warlocks1507.com account. Opens the
// browser to Google's sign-in, which goes through the team's Internal OAuth app.
// The resulting refresh token is saved in data/google-auth.json (never committed).
// Needs data/google-oauth-client.json (see README → Mentor dashboard).
// ==============================================================================

import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SCOPES, readClientFile } from '../laptop/google-auth.js';

const DATA = process.env.SCOUT_DATA || fileURLToPath(new URL('../data/', import.meta.url));
const CLIENT_FILE = join(DATA, 'google-oauth-client.json');
const AUTH_FILE = join(DATA, 'google-auth.json');

if (!existsSync(CLIENT_FILE)) {
  console.error(`✗ Missing ${CLIENT_FILE}\n  Download the Desktop OAuth client JSON from Google Cloud Console and save it there.`);
  process.exit(1);
}
const client = readClientFile(CLIENT_FILE);
const verifier = randomBytes(32).toString('base64url');
const challenge = createHash('sha256').update(verifier).digest('base64url');
const state = randomBytes(12).toString('hex');

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/') { res.writeHead(404); return res.end(); }
  const done = (status, msg) => {
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<body style="font:18px sans-serif;background:#0a0a1a;color:#eee;text-align:center;padding:60px">
      <h1 style="color:#FFD700">⚡ ${msg}</h1><p>You can close this tab.</p></body>`);
  };
  if (url.searchParams.get('state') !== state) return done(400, 'Sign-in failed: state mismatch — run the command again');
  if (url.searchParams.get('error')) {
    done(400, `Sign-in cancelled (${url.searchParams.get('error')})`);
    console.error(`✗ Google said: ${url.searchParams.get('error')}`);
    return shutdown(1);
  }
  try {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ ...client, code: url.searchParams.get('code'), code_verifier: verifier,
        grant_type: 'authorization_code', redirect_uri: redirectUri }),
    });
    const tok = await tokenRes.json();
    if (!tok.refresh_token) throw new Error(tok.error_description || tok.error || 'no refresh token returned');
    const email = tok.id_token ? JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString()).email : null;
    mkdirSync(DATA, { recursive: true });
    writeFileSync(AUTH_FILE, JSON.stringify({ ...client, refresh_token: tok.refresh_token, email,
      scopes: tok.scope, created: new Date().toISOString() }, null, 2));
    done(200, `Scan station signed in as ${email || 'your account'}`);
    console.log(`✓ Signed in as ${email}. Saved to data/google-auth.json — the scan station will use it for sync.`);
    shutdown(0);
  } catch (err) {
    done(500, 'Sign-in failed — see the terminal');
    console.error(`✗ ${err.message}`);
    shutdown(1);
  }
});

let redirectUri;
function shutdown(code) { setTimeout(() => { server.close(); process.exit(code); }, 300); }

server.listen(0, '127.0.0.1', () => {
  redirectUri = `http://127.0.0.1:${server.address().port}`;
  const auth = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  auth.search = new URLSearchParams({
    client_id: client.client_id, redirect_uri: redirectUri, response_type: 'code', scope: SCOPES.join(' '),
    access_type: 'offline', prompt: 'consent', code_challenge: challenge, code_challenge_method: 'S256', state,
  }).toString();
  console.log('Opening Google sign-in in your browser — sign in with the team (warlocks1507.com) account.');
  console.log(`If it doesn't open, paste this link into a browser:\n${auth}\n`);
  // rundll32's URL handler opens the default browser without cmd.exe mangling the '&'s in the link.
  const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', auth.href]]
    : process.platform === 'darwin' ? ['open', [auth.href]] : ['xdg-open', [auth.href]];
  spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  setTimeout(() => { console.error('✗ Timed out waiting for sign-in (5 minutes).'); shutdown(1); }, 5 * 60 * 1000).unref();
});
