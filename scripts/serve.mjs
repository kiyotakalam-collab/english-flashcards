import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = resolve(process.env.SERVE_DIR || '.');
const prefix = '/english-flashcards/';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (path === '/english-flashcards') { res.writeHead(302, { Location: prefix }); res.end(); return; }
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
    const filename = resolve(root, path.replace(/^\//, '') || 'index.html');
    if (filename !== root && !filename.startsWith(root + '/')) { res.writeHead(403); res.end(); return; }
    const data = await readFile(filename);
    res.writeHead(200, { 'Content-Type': types[extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}).listen(Number(process.env.PORT || 4173), '0.0.0.0', () => console.log(`Serving ${root} at http://localhost:${process.env.PORT || 4173}${prefix}`));
