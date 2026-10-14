// Local preview that mimics Vercel: serves public/ (plus the public files in
// data/) and routes /api/<name> to api/<name>.js. Reads MAPBOX_TOKEN from .env.local on every request, so
// editing that file needs no restart. Usage: npm run dev
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PUBLIC_DATA, PUBLIC_DATA_DIRS } from './copy-data.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.geojson': 'application/geo+json', '.topojson': 'application/json', '.svg': 'image/svg+xml', '.md': 'text/markdown; charset=utf-8', '.png': 'image/png' };

function loadEnv() {
  const file = join(root, '.env.local');
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  try {
    const api = pathname.match(/^\/api\/([a-z0-9-]+)$/);
    if (api) {
      loadEnv();
      const { default: handler } = await import(join(root, 'api', `${api[1]}.js`));
      res.status = (code) => ((res.statusCode = code), res);
      res.json = (body) => (res.setHeader('Content-Type', 'application/json'), res.end(JSON.stringify(body)));
      return await handler(req, res);
    }
    // /data/<file> and /data/reach/<file> are served from data/ (Vercel
    // copies these at build time).
    const data = pathname.match(/^\/data\/(?:([\w-]+)\/)?([\w.-]+)$/);
    if (data && (data[1] ? PUBLIC_DATA_DIRS.includes(data[1]) : PUBLIC_DATA.includes(data[2]))) {
      const body = await readFile(join(root, 'data', data[1] || '', data[2]));
      res.writeHead(200, { 'Content-Type': TYPES[extname(data[2])] });
      return res.end(body);
    }
    const rel = normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.[/\\])+/, '');
    const body = await readFile(join(root, 'public', rel));
    res.writeHead(200, { 'Content-Type': TYPES[extname(rel)] || 'application/octet-stream' });
    res.end(body);
  } catch (err) {
    res.writeHead(err.code === 'ENOENT' || err.code === 'ERR_MODULE_NOT_FOUND' ? 404 : 500);
    res.end(err.code === 'ENOENT' ? 'Not found' : String(err));
  }
}).listen(PORT, () => console.log(`Link tracker running at http://localhost:${PORT}`));
