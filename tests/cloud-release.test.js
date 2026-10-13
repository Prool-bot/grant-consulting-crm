'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const verify = require('../scripts/verify-cloud-release');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-release-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'Code.gs'), '// Синтетичний сервер для перевірки випуску.');
  fs.writeFileSync(path.join(root, 'Server.gs'), '// Синтетична бізнес-логіка для перевірки.');
  fs.writeFileSync(path.join(root, 'Index.html'), '<script>CRM_REMOTE=true</script>Картка клієнта Огляд Редагувати');
  fs.writeFileSync(path.join(root, 'appsscript.json'), JSON.stringify({
    webapp: { access: 'MYSELF', executeAs: 'USER_ACCESSING' }
  }));
  return root;
}

test('випуск приймає повну приватну збірку', t => {
  assert.doesNotThrow(() => verify(fixture(t)));
});

test('випуск відхиляє зайві, відсутні та порожні файли', t => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'extra.js'), 'зайвий файл');
  assert.throws(() => verify(root), /лише/);
  fs.unlinkSync(path.join(root, 'extra.js'));
  fs.unlinkSync(path.join(root, 'Code.gs'));
  assert.throws(() => verify(root), /лише/);
  fs.writeFileSync(path.join(root, 'Code.gs'), ' ');
  assert.throws(() => verify(root), /Порожній файл/);
});

test('випуск блокує публічний доступ та виконання від власника', t => {
  const root = fixture(t);
  for (const webapp of [
    { access: 'ANYONE_ANONYMOUS', executeAs: 'USER_ACCESSING' },
    { access: 'MYSELF', executeAs: 'USER_DEPLOYING' }
  ]) {
    fs.writeFileSync(path.join(root, 'appsscript.json'), JSON.stringify({ webapp }));
    assert.throws(() => verify(root), /MYSELF/);
  }
});

test('випуск блокує старий інтерфейс і зовнішні ресурси', t => {
  const root = fixture(t);
  const file = path.join(root, 'Index.html');
  const valid = fs.readFileSync(file, 'utf8');
  for (const html of [
    valid.replace('CRM_REMOTE=true', 'CRM_REMOTE=false'),
    valid.replace('Картка клієнта', 'Старий інтерфейс'),
    valid + '<script src="https://example.invalid/app.js"></script>',
    valid + '<link rel="stylesheet" href="https://example.invalid/app.css">'
  ]) {
    fs.writeFileSync(file, html);
    assert.throws(() => verify(root), /збірка|інтерфейс/);
  }
});
