const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../source/shared/registry');
require('../source/web/demo');
const { applications: rows, clients } = CrmDemo;
test('Кожна демозаявка має унікальний ID, відомого клієнта та статус', () => {
  assert.equal(new Set(rows.map(r => r.id)).size, rows.length);
  for (const row of rows) { assert.ok(clients.some(c => c.id === row.client_id)); assert.ok(R.statuses[row.status]); }
});
test('Пошук реєстру та одночасні фільтри клієнта/статусу', () => {
  assert.equal(R.select(rows, clients, { query: '  ШКОЛА  ' }).length, 1);
  assert.equal(R.select(rows, clients, { query: 'освітній фонд' }).length, 1);
  assert.equal(R.select(rows, clients, { query: 'Добра справа' }).length, 2);
  assert.equal(R.select(rows, clients, { clientId: clients[0].id, status: 'submitted' })[0].application_no, 'ДЕМО-002');
  assert.equal(R.select(rows, clients, { query: 'невідоме' }).length, 0);
});
test('Числове сортування в обох напрямках, невідомі суми останні, джерело незмінне', () => {
  const before = JSON.stringify(rows);
  assert.deepEqual(R.select(rows, clients, { sort: 'amount' }).map(r => r.amount), [4000, 8000, 10000, 12000, 25000, null]);
  assert.deepEqual(R.select(rows, clients, { sort: 'amount', direction: 'desc' }).map(r => r.amount), [25000, 12000, 10000, 8000, 4000, null]);
  assert.equal(JSON.stringify(rows), before);
});
test('Групування збирає клієнтів разом і сортує заявки всередині груп', () => {
  const selected = R.select(rows, clients, { grouped: true, sort: 'amount', direction: 'desc' });
  assert.equal(selected.length, rows.length);
  const groups = [];
  for (const row of selected) if (groups.at(-1) !== row.client_id) groups.push(row.client_id);
  assert.equal(new Set(groups).size, groups.length);
  assert.deepEqual(selected.filter(r => r.client_id === clients[0].id).map(r => r.amount), [25000, 12000]);
});
test('Дедлайни сортуються хронологічно', () => {
  const selected = R.select(rows, clients);
  assert.equal(selected[0].application_no, 'ДЕМО-003');
  assert.equal(selected.at(-1).application_no, 'ДЕМО-004');
  const dates = [{ ...rows[0], id: 'a', deadline: '2026-10-12T10:00:00+03:00' }, { ...rows[0], id: 'b', deadline: '2026-10-12T08:00:00Z' }];
  assert.deepEqual(R.select(dates, clients).map(r => r.id), ['a', 'b']);
});
