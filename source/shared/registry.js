(function (root) {
  'use strict';
  const statuses = { assessment: 'Оцінювання', preparation: 'У роботі', review: 'Перевірка', submitted: 'Подано · рішення очікується', rejected: 'Відхилено', won: 'Виграно', stopped: 'Зупинено' };
  function select(rows, clients, { query = '', clientId = '', status = '', sort = 'deadline', direction = 'asc', grouped = false } = {}) {
    const names = new Map(clients.map(c => [c.id, c.legal_name]));
    const needle = query.trim().toLocaleLowerCase('uk');
    const result = rows.map(row => ({ ...row, client: names.get(row.client_id) || 'Клієнта не знайдено' }))
      .filter(row => (!clientId || row.client_id === clientId) && (!status || row.status === status) &&
        [row.title, row.client, row.grant, row.donor].join(' ').toLocaleLowerCase('uk').includes(needle));
    const field = ['application_no', 'submission_at', 'title', 'client', 'grant', 'deadline', 'status', 'amount'].includes(sort) ? sort : 'deadline';
    const compare = (a, b) => String(a).localeCompare(String(b), 'uk', { numeric: true });
    return result.sort((a, b) => {
      if (grouped && a.client_id !== b.client_id) return compare(a.client, b.client) || compare(a.client_id, b.client_id);
      const value = row => field === 'status' ? statuses[row.status] : ['deadline', 'submission_at'].includes(field) ? (row[field] && Number.isFinite(Date.parse(row[field])) ? Date.parse(row[field]) : null) : row[field];
      // Різні валюти впорядковуються окремими групами без конвертації.
      if (field === 'amount' && (a.currency || 'EUR') !== (b.currency || 'EUR')) return compare(a.currency || 'EUR', b.currency || 'EUR');
      const left = value(a);
      const right = value(b);
      // Невідомі значення завжди в кінці, незалежно від напрямку.
      if (left == null || right == null) return left == null && right == null ? compare(a.id, b.id) : left == null ? 1 : -1;
      return compare(left, right) * (direction === 'desc' ? -1 : 1) || compare(a.id, b.id);
    });
  }
  const api = { statuses, select };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CrmRegistry = api;
})(globalThis);
