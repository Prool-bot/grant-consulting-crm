const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
test('Збірка автономна, маніфест без OAuth; сервер повертає лише відмову', () => {
  require('../scripts/build');
  const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const html = read('dist/apps-script/Index.html');
  assert.match(html, /lang="uk"/);
  assert.doesNotMatch(html, /<script src=|<link rel="stylesheet"/);
  assert.deepEqual(JSON.parse(read('dist/apps-script/appsscript.json')).oauthScopes, []);
  const context = { HtmlService: { createHtmlOutput: value => value } };
  vm.createContext(context); vm.runInContext(read('source/server/Code.gs'), context);
  assert.match(context.doGet(), /Доступ закрито/);
  assert.doesNotMatch(context.doGet(), /Демо: Простір/);
});
