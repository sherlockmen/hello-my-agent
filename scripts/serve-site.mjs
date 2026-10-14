import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site-dist');
const port = Number(process.env.SITE_PORT || 4173);
const prefix = '/hello-my-agent/';
if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('请先运行 npm run site:build');
const types = { '.html': 'text/html', '.md': 'text/plain', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.webp': 'image/webp' };
http.createServer((request, response) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); }
  catch { response.writeHead(400).end(); return; }
  if (pathname === '/') { response.writeHead(302, { Location: prefix }).end(); return; }
  if (!pathname.startsWith(prefix)) { response.writeHead(404).end(); return; }
  const file = path.resolve(root, pathname.slice(prefix.length) || 'index.html');
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404).end('Not found'); return; }
  response.setHeader('Content-Type', `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8`);
  response.setHeader('Cache-Control', 'no-cache');
  fs.createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => console.log(`教程预览：http://127.0.0.1:${port}${prefix}`));
