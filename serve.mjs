/**
 * Minimal static server for local development.
 *
 * Opening index.html straight from the file system does not work: browsers
 * refuse to load ES modules over file://, so the page must be served over
 * http. This uses only the Node standard library, keeping the project free of
 * dependencies.
 *
 *   npm start   →   http://localhost:8000
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = import.meta.dirname;
const PORT = Number(process.env.PORT ?? 8000);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

createServer(async (request, response) => {
  const url = new URL(request.url, `http://localhost:${PORT}`);
  const requested = url.pathname === '/' ? '/index.html' : url.pathname;

  // Refuse to serve anything outside the project directory.
  const path = join(ROOT, normalize(requested).replace(/^(\.\.[/\\])+/, ''));
  if (!path.startsWith(ROOT)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(path);
    response.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(PORT, () => {
  console.log(`Spatial Affectability running on http://localhost:${PORT}`);
});
