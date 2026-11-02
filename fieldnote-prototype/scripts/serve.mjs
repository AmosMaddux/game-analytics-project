import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PUBLIC_FILES, publicRequestPath, readPublicFile} from './public-files.mjs';

const root = path.resolve(import.meta.dirname, '..');
const files = PUBLIC_FILES;
const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'};

export function createRequestHandler(documentRoot = root) {
  return async (req, res) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, {'Allow': 'GET, HEAD'});
      res.end('Method not allowed');
      return;
    }
    try {
      const requestPath = publicRequestPath(req.url);
      if (!Object.hasOwn(files, requestPath)) throw new Error('Not public');
      const content = await readPublicFile(documentRoot, files[requestPath]);
      res.writeHead(200, {
        'Content-Type': types[path.extname(requestPath)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : content);
    } catch {
      // Do not echo paths, configuration, filesystem errors or request details.
      res.writeHead(404, {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
      res.end(req.method === 'HEAD' ? undefined : 'Not found');
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const port = 4173;
  http.createServer(createRequestHandler()).listen(port, '127.0.0.1', () => console.log(`Fieldnote running at http://localhost:${port} (Codespace loopback; keep forwarded port private)`));
}
