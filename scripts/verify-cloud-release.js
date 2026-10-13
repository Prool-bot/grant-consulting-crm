'use strict';
const fs = require('node:fs');
const path = require('node:path');
function verifyCloudRelease(root = path.resolve(__dirname, '..', 'dist', 'apps-script')) {
const expected = ['Code.gs', 'Server.gs', 'Index.html', 'appsscript.json'];
const actual = fs.readdirSync(root).sort();
if (JSON.stringify(expected.slice().sort()) !== JSON.stringify(actual)) {
  throw Error(`Відхилено: збірка має містити лише ${expected.join(', ')}; знайдено ${actual.join(', ')}`);
}
for (const file of expected) {
  const text = fs.readFileSync(path.join(root, file), 'utf8');
  if (text.trim().length < 30) throw Error(`Порожній файл: ${file}`);
}
const config = JSON.parse(fs.readFileSync(path.join(root, 'appsscript.json'), 'utf8'));
if (config.webapp?.access !== 'MYSELF' || config.webapp?.executeAs !== 'USER_ACCESSING') {
  throw Error('Відхилено: доступ до вебзастосунку має бути MYSELF / USER_ACCESSING.');
}
const html = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
if (!html.includes('CRM_REMOTE=true') || /<script\b[^>]*\bsrc\s*=|<link\b[^>]*\brel\s*=\s*["']stylesheet/i.test(html)) {
  throw Error('Небезпечна або неповна вебзбірка: зовнішні скрипти/стилі чи відсутній режим CRM_REMOTE.');
}
// Захист від випадкового повернення старого інтерфейсу з main.
for (const marker of ['Картка клієнта', 'Огляд', 'Редагувати']) {
  if (!html.includes(marker)) {
    throw Error(`Головна гілка ще не містить новий інтерфейс клієнтів (${marker}). Оновіть source/* через Codex, потім повторіть випуск.`);
  }
}
}
module.exports = verifyCloudRelease;
if (require.main === module) {
  verifyCloudRelease(process.argv[2]);
  console.log('Збірка та приватні параметри доступу перевірені.');
}
