// Local dev server: serves public/ and the /api/feed function. Usage: npm run dev
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { GET } from './api/feed.js';

const port = process.env.PORT || 3000;

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/api/feed') {
    const response = await GET(new Request(url));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }
  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(await readFile(new URL('./public/index.html', import.meta.url)));
    return;
  }
  res.writeHead(404).end('Not found');
}).listen(port, () => console.log(`icalfilter running at http://localhost:${port}`));
