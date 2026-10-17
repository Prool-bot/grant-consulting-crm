'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(path.join(out, 'local'), { recursive: true });
fs.mkdirSync(path.join(out, 'apps-script'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'demo.js', 'registry.js', 'm2.js', 'remote.js']) fs.copyFileSync(path.join(root, 'source/web', file), path.join(out, 'local', file));
fs.copyFileSync(path.join(root, 'source/shared/registry.js'), path.join(out, 'local/registry-domain.js'));
fs.copyFileSync(path.join(root, 'source/server/core.js'), path.join(out, 'local/core.js'));
fs.copyFileSync(path.join(root, 'source/shared/domain.js'), path.join(out, 'local/domain.js'));
for (const file of ['Code.gs', 'appsscript.json']) fs.copyFileSync(path.join(root, 'source/server', file), path.join(out, 'apps-script', file));
// Один файл гарантує порядок ініціалізації модулів без Node/CommonJS у V8.
const server=require('./bundle-server')();
fs.writeFileSync(path.join(out,'apps-script/Server.gs'),server);
let html = fs.readFileSync(path.join(root, 'source/web/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>${fs.readFileSync(path.join(root, 'source/web/styles.css'), 'utf8')}</style>`)
  .replace(/<script src="(domain|registry-domain|registry|demo|core|remote|m2|app)\.js"><\/script>/g, (_, name) => `<script>${fs.readFileSync(path.join(root, name === 'core' ? 'source/server/core.js' : name === 'domain' ? 'source/shared/domain.js' : name === 'registry-domain' ? 'source/shared/registry.js' : `source/web/${name}.js`), 'utf8')}</script>`);
html=html.replace(/<script>[\s\S]*?<\/script>/g, block=>block.includes('CrmDemo =')||block.includes('root.CrmDemo')?'':block);
html=html.replace('<head>', '<head><script>globalThis.CRM_REMOTE=true;</script>')
 .replace(/<a href="#tasks">.*?<\/a><a href="#grants">.*?<\/a>/, '')
 .replace(/<div class="sidebar-note">[\s\S]*?<\/div>/, '<div class="sidebar-note"><strong>CRM 1.2</strong><p>Google Sheets · лише власник</p></div>')
 .replace('Демонстрація</span>', 'Приватна CRM</span>')
 .replace(/<footer>[\s\S]*?<\/footer>/, '<footer>CRM 1.2 · Europe/Kyiv</footer>');
fs.writeFileSync(path.join(out, 'apps-script/Index.html'), html);
console.log('CRM 1.2 для Apps Script і локальну демонстрацію зібрано.');
