// Local test server for the scout app and lead tools. No dependencies.
// Run: npm run serve   then open http://localhost:8080/
//
// The camera only works on HTTPS or localhost, so to test on a real iPad use
// the GitHub Pages copy (see README). This server is for desktop testing.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 8080;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

createServer(async (req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path === '/') { res.writeHead(302, { Location: '/scout-app/' }); return res.end(); }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT) || file.includes(`${sep}.git`)) { res.writeHead(403); return res.end(); }
  try {
    if ((await stat(file)).isDirectory()) { res.writeHead(302, { Location: `${path}/` }); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Scout app:  http://localhost:${PORT}/scout-app/`);
  console.log(`Lead tools: http://localhost:${PORT}/scout-app/lead.html`);
});
