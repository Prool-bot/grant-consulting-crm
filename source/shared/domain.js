(function (root) {
  'use strict';
  const types = { ngo: 'ГО', foundation: 'Благодійний фонд', company: 'Компанія', entrepreneur: 'ФОП', individual: 'Фізична особа' };
  const statuses = { potential: 'Потенційний', negotiation: 'Переговори', active: 'Активний', paused: 'Пауза', completed: 'Завершений', archived: 'Архів' };
  const taskStatuses = { todo: 'Заплановано', in_progress: 'У роботі', completed: 'Виконано', cancelled: 'Скасовано' };
  function uuid() { return globalThis.crypto.randomUUID(); }
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value || '')) return false;
    const day = value.slice(0, 10);
    return Number.isFinite(Date.parse(value)) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
  }
  function validateClient(client) {
    const errors = {};
    if (typeof client.legal_name !== 'string' || !client.legal_name.trim()) errors.legal_name = 'Вкажіть назву або ім’я.';
    if (!Object.hasOwn(types, client.type)) errors.type = 'Оберіть тип клієнта.';
    if (!Object.hasOwn(statuses, client.status)) errors.status = 'Оберіть коректний статус.';
    if (client.edrpou_optional && client.type !== 'individual' && !/^\d{8}$/.test(client.edrpou_optional)) errors.edrpou_optional = 'Код ЄДРПОУ має містити 8 цифр.';
    if (client.next_action_at && !validDate(client.next_action_at)) errors.next_action_at = 'Вкажіть дату з часовим поясом.';
    return errors;
  }
  function normalizeUrl(value) {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Потрібне HTTPS-посилання без облікових даних.');
    url.hash = '';
    url.searchParams.sort();
    return url.href;
  }
  function validateGrant(grant) {
    const errors = {};
    if (!grant.title?.trim()) errors.title = 'Вкажіть назву гранту.';
    try { normalizeUrl(grant.official_url); } catch { errors.official_url = 'Вкажіть коректне HTTPS-посилання.'; }
    for (const field of ['amount_min', 'amount_max']) {
      if (grant[field] != null && grant[field] !== '' && (typeof grant[field] !== 'number' || !Number.isFinite(grant[field]) || grant[field] < 0)) errors[field] = 'Сума має бути невід’ємним числом.';
    }
    if (typeof grant.amount_min === 'number' && typeof grant.amount_max === 'number' && grant.amount_min > grant.amount_max) errors.amount_max = 'Максимум менший за мінімум.';
    if (grant.deadline_at && !validDate(grant.deadline_at)) errors.deadline_at = 'Вкажіть дедлайн із часовим поясом.';
    return errors;
  }
  function searchClients(clients, { query = '', type = '', status = '' } = {}) {
    const needle = query.trim().toLocaleLowerCase('uk');
    return clients.filter(c => (!type || c.type === type) && (!status || c.status === status) &&
      [c.client_no, c.legal_name, c.short_name, c.location, c.geography, ...(c.contacts || []), ...(c.sectors || [])].join(' ').toLocaleLowerCase('uk').includes(needle));
  }
  function transitionTask(task, status, now = new Date().toISOString()) {
    if (!Object.hasOwn(taskStatuses, task.status) || !Object.hasOwn(taskStatuses, status)) throw new Error('Невідомий статус завдання.');
    if (task.status === status) return { ...task };
    if (['completed', 'cancelled'].includes(task.status)) throw new Error('Завершене завдання не змінюється у прототипі.');
    if (!validDate(now)) throw new Error('Некоректна дата зміни.');
    return { ...task, status, completed_at: status === 'completed' ? now : null, updated_at: now };
  }
  function applicationSummaries(applications, now = Date.now()) {
    const index = new Map();
    for (const a of applications) {
      if (a.deleted_at) continue;
      if (!index.has(a.client_id)) index.set(a.client_id, { application_count: 0, requested: {}, awarded: {}, requested_unknown: 0, awarded_unknown: 0, next_deadline: null, last_application: null });
      const s = index.get(a.client_id); s.application_count++;
      for (const [field, key] of [['amount', 'requested'], ['award_amount', 'awarded']]) {
        if (typeof a[field] !== 'number' || !Number.isFinite(a[field]) || !a.currency) s[key + '_unknown']++;
        else s[key][a.currency] = (s[key][a.currency] || 0) + a[field];
      }
      if (validDate(a.created_at) && (!s.last_application || Date.parse(a.created_at) > Date.parse(s.last_application))) s.last_application = a.created_at;
      if (!a.archived_at && !['rejected', 'stopped', 'won'].includes(a.status) && validDate(a.deadline) && Date.parse(a.deadline) > now && (!s.next_deadline || Date.parse(a.deadline) < Date.parse(s.next_deadline))) s.next_deadline = a.deadline;
    }
    return index;
  }
  function compareSummary(a, b, key, direction) {
    const money = ['requested', 'awarded'].includes(key);
    const left = money ? Object.keys(a[key] || {}).sort() : a[key];
    const right = money ? Object.keys(b[key] || {}).sort() : b[key];
    const missing = v => money ? !v.length : !v;
    if (missing(left) || missing(right)) return missing(left) === missing(right) ? 0 : missing(left) ? 1 : -1;
    const sign = direction === 'desc' ? -1 : 1;
    if (!money) return (Date.parse(left) - Date.parse(right)) * sign;
    // Спочатку незмінні групи наборів валют; усередині — числовий вектор у порядку валют.
    const group = left.join('/').localeCompare(right.join('/'));
    if (group) return group;
    for (const currency of left) if (a[key][currency] !== b[key][currency]) return (a[key][currency] - b[key][currency]) * sign;
    return 0;
  }
  const api = { types, statuses, taskStatuses, uuid, validDate, validateClient, validateGrant, normalizeUrl, searchClients, transitionTask, applicationSummaries, compareSummary };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CrmDomain = api;
})(globalThis);
