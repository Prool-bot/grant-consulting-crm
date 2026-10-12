'use strict';
require('./build');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const files = { '/': ['index.html', 'text/html'], '/index.html': ['index.html', 'text/html'], '/styles.css': ['styles.css', 'text/css'], '/domain.js': ['domain.js', 'text/javascript'], '/demo.js': ['demo.js', 'text/javascript'], '/app.js': ['app.js', 'text/javascript'] };
const server = http.createServer((req, res) => {
  const file = files[req.url];
  if (!file || !['GET', 'HEAD'].includes(req.method)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; connect-src 'none'; img-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
  res.end(req.method === 'HEAD' ? undefined : fs.readFileSync(path.join(__dirname, '../dist/local', file[0])));
});
files['/registry-domain.js'] = ['registry-domain.js', 'text/javascript'];
files['/registry.js'] = ['registry.js', 'text/javascript'];
files['/core.js'] = ['core.js', 'text/javascript'];
files['/m2.js'] = ['m2.js', 'text/javascript'];
const port = Number(process.env.PORT || 4173);
server.listen(port, '127.0.0.1', () => console.log(`Прототип: http://127.0.0.1:${port} · завершення: Ctrl+C`));
server.on('error', () => { console.error('Не вдалося запустити локальний сервер. Перевірте порт 4173.'); process.exitCode = 1; });
