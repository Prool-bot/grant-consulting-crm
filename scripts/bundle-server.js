'use strict';
const fs=require('node:fs');
const path=require('node:path');
module.exports=function bundleServer() {
  const root=path.resolve(__dirname,'..');
  const files=['source/shared/domain.js','source/server/core.js','source/adapters/sheets.js','source/server/gateway.js'];
  const server=files.map(file=>fs.readFileSync(path.join(root,file),'utf8')
    .replace(/typeof module !== 'undefined' \? require\('[^']+'\) : root\.(\w+)/g,'root.$1')
    .replace(/typeof module!=='undefined'\?require\('[^']+'\):root\.(\w+)/g,'root.$1')
    .replace(/if\(typeof module\s*!==\s*'undefined'\)\s*module\.exports\s*=\s*api;\s*else\s*/g,'')
    .replace(/if \(typeof module !== 'undefined'\) module.exports = api;\s*else /g,''))
    .join('\n');
  if(/\brequire\(|module\.exports/.test(server))throw Error('Непідтримуваний CommonJS у серверній збірці.');
  return server;
};
