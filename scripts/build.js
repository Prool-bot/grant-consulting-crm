'use strict';
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist');
fs.mkdirSync(path.join(out, 'local'), { recursive: true });
fs.mkdirSync(path.join(out, 'apps-script'), { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'demo.js', 'registry.js', 'm2.js']) fs.copyFileSync(path.join(root, 'source/web', file), path.join(out, 'local', file));
fs.copyFileSync(path.join(root, 'source/shared/registry.js'), path.join(out, 'local/registry-domain.js'));
fs.copyFileSync(path.join(root, 'source/server/core.js'), path.join(out, 'local/core.js'));
fs.copyFileSync(path.join(root, 'source/shared/domain.js'), path.join(out, 'local/domain.js'));
for (const file of ['Code.gs', 'appsscript.json']) fs.copyFileSync(path.join(root, 'source/server', file), path.join(out, 'apps-script', file));
const html = fs.readFileSync(path.join(root, 'source/web/index.html'), 'utf8')
  .replace('<link rel="stylesheet" href="styles.css">', () => `<style>${fs.readFileSync(path.join(root, 'source/web/styles.css'), 'utf8')}</style>`)
  .replace(/<script src="(domain|registry-domain|registry|demo|core|m2|app)\.js"><\/script>/g, (_, name) => `<script>${fs.readFileSync(path.join(root, name === 'core' ? 'source/server/core.js' : name === 'domain' ? 'source/shared/domain.js' : name === 'registry-domain' ? 'source/shared/registry.js' : `source/web/${name}.js`), 'utf8')}</script>`);
fs.writeFileSync(path.join(out, 'apps-script/Index.html'), html);
console.log('Локальний прототип і закритий каркас Apps Script зібрано.');
