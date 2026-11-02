import { createServer } from 'node:http';
import { lstat, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { appRoot, openDatabase, migrate } from './database.mjs';
import { handleRequest } from '../build/worker.mjs';

const PUBLIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/assets/app.js', ['assets/app.js', 'text/javascript; charset=utf-8']],
  ['/assets/app.css', ['assets/app.css', 'text/css; charset=utf-8']],
  ['/docs/roadmap.docx', ['docs/roadmap.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']],
]);
export const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
};
function safePath(rawPath) {
  try {
    const path = decodeURIComponent(rawPath.split('?')[0]);
    if (!path.startsWith('/') || /[%\\\0]/.test(path) || path.split('/').some(segment => segment === '..' || segment === '.' || segment.startsWith('.'))) return null;
    return path;
  } catch { return null; }
}
async function safeRead(root, filename) {
  const full = resolve(root, filename);
  if (relative(root, full).startsWith('..')) throw new Error('Outside public root');
  let current = root;
  if ((await lstat(current)).isSymbolicLink()) throw new Error('Public root symlink');
  for (const segment of filename.split(sep)) {
    current = resolve(current, segment);
    if ((await lstat(current)).isSymbolicLink()) throw new Error('Public symlink');
  }
  if (!(await lstat(full)).isFile()) throw new Error('Not a file');
  return readFile(full);
}

export async function routeRequest(request, env, { publicRoot = resolve(appRoot, 'dist'), rawPath = new URL(request.url).pathname } = {}) {
  const path = safePath(rawPath);
  let response;
  if (!path) response = new Response('Not found', { status: 404 });
  else if (path === '/api' || path.startsWith('/api/')) response = await handleRequest(request, env);
  else if (!['GET', 'HEAD'].includes(request.method)) response = new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  else {
    const asset = PUBLIC_FILES.get(path);
    if (!asset) response = new Response('Not found', { status: 404 });
    else {
      try {
        const bytes = await safeRead(publicRoot, asset[0]);
        response = new Response(request.method === 'HEAD' ? null : bytes, { headers: { 'Content-Type': asset[1], 'Content-Length': String(bytes.byteLength) } });
      } catch { response = new Response('Not found', { status: 404 }); }
    }
  }
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) headers.set(key, value);
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

export function createAppServer(db) {
  return createServer(async (req, res) => {
    try {
      const host = req.headers.host;
      if (!host || /[\s/\\]/.test(host)) { res.writeHead(400); res.end('Invalid host'); return; }
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      const chunks = []; let length = 0;
      for await (const chunk of req) {
        length += chunk.length;
        if (length > 8192) { res.writeHead(413, SECURITY_HEADERS); res.end('Request too large'); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      const request = new Request(`${protocol}://${host}${req.url}`, {
        method: req.method,
        headers: Object.entries(req.headers).filter(([, value]) => value !== undefined).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : value]),
        ...(!['GET', 'HEAD'].includes(req.method) && body.length ? { body } : {}),
      });
      const response = await routeRequest(request, { DB: db }, { rawPath: req.url });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch {
      res.writeHead(500, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('The local application could not complete this request.');
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(appRoot, 'scripts/serve.mjs')) {
  const port = Number(process.env.PORT || 4174);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('PORT must be an integer between 1024 and 65535.');
  const db = openDatabase(process.env.FIELDNOTE_DB);
  migrate(db);
  const count = db.raw.prepare('SELECT COUNT(*) AS count FROM games').get().count;
  if (!count) { db.close(); throw new Error('Database is empty. Run npm run db:seed before starting.'); }
  const server = createAppServer(db);
  server.listen(port, '127.0.0.1', () => console.log(`Fieldnote M3: http://127.0.0.1:${port} (saved evidence, persisted SQLite; no web-triggered collection)`));
  const close = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
}
