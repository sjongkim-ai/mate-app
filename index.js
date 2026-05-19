import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, 'public');
const port = Number(process.env.PORT) || 3333;

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function resolvePublicPath(urlPathname) {
  const decodedPath = decodeURIComponent(urlPathname);
  const routePath =
    decodedPath === '/' ? '/index.html' :
    decodedPath === '/matches' ? '/matches.html' :
    decodedPath === '/chat' ? '/chat.html' :
    decodedPath === '/admin' ? '/admin.html' :
    decodedPath === '/preferences' ? '/preferences.html' :
    decodedPath;

  const filePath = path.normalize(path.join(publicDir, routePath));
  if (!filePath.startsWith(publicDir)) return null;
  return filePath;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (url.pathname === '/api/me') {
    sendJson(res, 200, { user: null });
    return;
  }

  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/')) {
    sendJson(res, 404, { error: 'Not implemented in first-page mode' });
    return;
  }

  const filePath = resolvePublicPath(url.pathname);
  if (!filePath) {
    sendJson(res, 400, { error: 'Bad request' });
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    res.end(body);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }

    console.error(error);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.listen(port, () => {
  console.log(`TripMate first page: http://localhost:${port}`);
});
