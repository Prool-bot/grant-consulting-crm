'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const D = require('../source/shared/domain');
const { MemoryStorage, MemoryCalendar, DisabledGoogleAdapter, tables } = require('../source/adapters/memory');
require('../source/web/demo');
test('UUID v4: формат та унікальність 1000 значень', () => {
  const ids = Array.from({ length: 1000 }, () => D.uuid());
  assert.equal(new Set(ids).size, 1000);
  ids.forEach(id => assert.match(id, /^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/));
});
test('Валідація клієнтів: тип, статус, назва та необов’язковий код', () => {
  for (const type of Object.keys(D.types)) assert.deepEqual(D.validateClient({ legal_name: 'Демо', type, status: 'potential' }), {});
  assert.equal(Object.keys(D.validateClient({ legal_name: '  ', type: 'other', status: 'other' })).length, 3);
  assert.ok(D.validateClient({ legal_name: 'Демо', type: 'ngo', status: 'active', edrpou_optional: '123' }).edrpou_optional);
});
test('Дати вимагають пояс і справжню календарну дату', () => {
  assert.equal(D.validDate('2026-10-12T10:00:00+03:00'), true);
  for (const date of ['2026-10-12T10:00:00', '2026-02-30T10:00:00Z', '2026-13-01T10:00:00Z', 'wrong']) assert.equal(D.validDate(date), false);
});
test('Гранти: HTTPS, діапазони сум і невідома сума', () => {
  const grant = { title: 'Демо', official_url: 'https://example.invalid/grant', amount_min: null, amount_max: null };
  assert.deepEqual(D.validateGrant(grant), {});
  for (const url of ['http://example.invalid', 'javascript:alert(1)', 'https://user:pass@example.invalid']) assert.ok(D.validateGrant({ ...grant, official_url: url }).official_url);
  assert.ok(D.validateGrant({ ...grant, amount_min: 20, amount_max: 10 }).amount_max);
  assert.ok(D.validateGrant({ ...grant, amount_min: -1 }).amount_min);
  assert.equal(D.normalizeUrl('https://EXAMPLE.invalid/grant#section'), 'https://example.invalid/grant');
});
test('Пошук за назвою, контактом, географією, напрямом та комбіновані фільтри', () => {
  const rows = CrmDemo.clients;
  for (const query of ['ПРОСТІР', 'координаторка', 'освіта']) assert.equal(D.searchClients(rows, { query }).length, 1);
  assert.equal(D.searchClients(rows, { query: 'Умовна громада' }).length, 2);
  assert.equal(D.searchClients(rows, { type: 'ngo', status: 'active' }).length, 1);
  assert.equal(D.searchClients(rows, { type: 'ngo', status: 'paused' }).length, 0);
  assert.equal(D.searchClients(rows, { query: 'відсутній' }).length, 0);
});
test('Статуси завдання: завершення зберігає історію та є ідемпотентним', () => {
  const task = { id: 'demo-task', status: 'todo', description: 'Демо' };
  const result = D.transitionTask(task, 'completed', '2026-10-12T10:00:00Z');
  assert.equal(task.status, 'todo');
  assert.equal(result.description, 'Демо');
  assert.equal(result.completed_at, '2026-10-12T10:00:00Z');
  assert.deepEqual(D.transitionTask(result, 'completed'), result);
  assert.throws(() => D.transitionTask(result, 'todo'));
  assert.throws(() => D.transitionTask(task, 'unknown'));
});
test('Ініціалізація всіх таблиць без дублів і без перезапису змін', () => {
  const store = new MemoryStorage();
  assert.equal(tables.length, 14);
  store.initialize({ clients: CrmDemo.clients });
  store.put('clients', { ...CrmDemo.clients[0], legal_name: 'Змінений демозапис' });
  store.initialize({ clients: CrmDemo.clients });
  assert.equal(store.list('clients').length, 3);
  assert.equal(store.list('clients')[0].legal_name, 'Змінений демозапис');
  const copy = store.list('clients'); copy[0].legal_name = 'Інше';
  assert.equal(store.list('clients')[0].legal_name, 'Змінений демозапис');
});
test('Збій ініціалізації не залишає часткових записів', () => {
  const store = new MemoryStorage(); const before = store.snapshot();
  assert.throws(() => store.initialize({ clients: [{ id: 'demo' }, {}] }));
  assert.equal(store.snapshot(), before);
});
test('Знімок і відновлення тестового сховища; пошкоджений знімок не знищує дані', () => {
  const store = new MemoryStorage(); store.initialize({ clients: CrmDemo.clients });
  const snapshot = store.snapshot(); const restored = new MemoryStorage(); restored.restore(snapshot);
  assert.deepEqual(restored.list('clients'), store.list('clients'));
  for (const invalid of ['{', '{"version":2}', snapshot.replace('"tasks":[]', '"tasks":null')]) {
    assert.throws(() => restored.restore(invalid)); assert.equal(restored.snapshot(), snapshot);
  }
});
test('Календарний fake: одна подія на ключ, оновлення ID та ізольоване скасування', () => {
  const calendar = new MemoryCalendar();
  const first = calendar.upsert('task:demo-1', { date: '2026-10-12' });
  assert.equal(calendar.upsert('task:demo-1', { date: '2026-10-13' }).id, first.id);
  calendar.upsert('task:demo-2', { date: '2026-10-14' });
  calendar.cancel('task:demo-1'); calendar.cancel('task:demo-1');
  assert.equal(calendar.events.size, 1);
  assert.ok(calendar.events.has('task:demo-2'));
});
test('Google-адаптер закритий за замовчуванням', () => assert.throws(() => new DisabledGoogleAdapter().execute(), /вимкнені/));
