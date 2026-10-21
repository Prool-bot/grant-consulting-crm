(function (root) {
  'use strict';
  const types = { ngo: 'ГО', foundation: 'Благодійний фонд', company: 'Компанія', entrepreneur: 'ФОП', individual: 'Фізична особа', territorial_community: 'Територіальна громада', state_institution: 'Державна установа', institute: 'Інститут', communal_institution: 'Комунальна установа' };
  const statuses = { potential: 'Потенційний', negotiation: 'Переговори', active: 'Активний', paused: 'Пауза', completed: 'Завершений', archived: 'Архів' };
  const taskStatuses = { todo: 'Заплановано', in_progress: 'У роботі', completed: 'Виконано', cancelled: 'Скасовано' };
  function uuid() { return globalThis.crypto.randomUUID(); }
  function validDate(value) {
    if (dateOnly(value)) return true;
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value || '')) return false;
    const day = value.slice(0, 10);
    return Number.isFinite(Date.parse(value)) && new Date(day + 'T00:00:00Z').toISOString().slice(0, 10) === day;
  }
  function dateOnly(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value+'T00:00:00Z').toISOString().slice(0,10) === value;
  }
  function calendarDate(value) {
    if (dateOnly(value)) return value;
    if (!validDate(value)) return '';
    const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
    const get = key => parts.find(p=>p.type===key).value;
    return get('year')+'-'+get('month')+'-'+get('day');
  }
  function dateOrder(value) {
    if (!validDate(value)) return null;
    return calendarDate(value)+(dateOnly(value)?'':'T'+new Date(value).toISOString());
  }
  const socialPlatforms = {facebook:'Facebook',instagram:'Instagram',telegram:'Telegram',linkedin:'LinkedIn',youtube:'YouTube',tiktok:'TikTok',twitter:'X/Twitter',other:'Інша'};
  function organizationAge(client, now = new Date().toISOString()) {
    const day=calendarDate(now), registered=client.registration_date;
    if(client.type==='individual' || !dateOnly(registered) || !day || registered>day) return null;
    return Number(day.slice(0,4))-Number(registered.slice(0,4))-(day.slice(5)<registered.slice(5)?1:0);
  }
  function validateClient(client) {
    const errors = {};
    if (typeof client.legal_name !== 'string' || !client.legal_name.trim()) errors.legal_name = 'Вкажіть назву або ім’я.';
    if (!Object.hasOwn(types, client.type)) errors.type = 'Оберіть тип клієнта.';
    if (!Object.hasOwn(statuses, client.status)) errors.status = 'Оберіть коректний статус.';
    if (client.edrpou_optional && client.type !== 'individual' && !/^\d{8}$/.test(client.edrpou_optional)) errors.edrpou_optional = 'Код ЄДРПОУ має містити 8 цифр.';
    if (client.next_action_at && !validDate(client.next_action_at)) errors.next_action_at = 'Вкажіть коректну календарну дату.';
    if(client.nonprofit_code != null && client.nonprofit_code !== '' && (typeof client.nonprofit_code !== 'string' || !/^\d{4}$/.test(client.nonprofit_code))) errors.nonprofit_code='Код неприбутковості має бути рядком із 4 цифр.';
    if(client.registration_date && (!dateOnly(client.registration_date) || client.registration_date>calendarDate(new Date().toISOString()))) errors.registration_date='Дата реєстрації має бути реальною датою не пізніше сьогодні.';
    if(client.catalog_note != null && (typeof client.catalog_note!=='string' || client.catalog_note.length>2000)) errors.catalog_note='Примітка має містити не більше 2000 символів.';
    if(client.social_links !== undefined) {
      if(!Array.isArray(client.social_links)) errors.social_links='Соціальні мережі мають бути списком.';
      else for(const link of client.social_links) {
        try { if(!link || !Object.hasOwn(socialPlatforms,link.platform) || (link.label!==undefined && typeof link.label!=='string')) throw Error(); normalizeUrl(link.url); }
        catch {errors.social_links='Оберіть платформу та вкажіть безпечне HTTPS-посилання.';}
      }
    }
    return errors;
  }
  function normalizeUrl(value) {
    // Apps Script V8 не надає WHATWG URL: однакова перевірка в обох середовищах.
    if(typeof value !== 'string' || /[\s\\<>"'\x00-\x1f]/.test(value)) throw Error('Потрібне HTTPS-посилання без облікових даних.');
    const match = /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?([/?#].*)?$/i.exec(value);
    if(!match || match[1].split('.').some(label=>!label || label.startsWith('-') || label.endsWith('-')) || (match[2] && (+match[2]<1 || +match[2]>65535))) throw Error('Потрібне HTTPS-посилання без облікових даних.');
    const tail=(match[3]||'/').split('#')[0]||'/';
    return 'https://'+match[1].toLowerCase()+(match[2]?':'+match[2]:'')+(tail.startsWith('?')?'/'+tail:tail);
  }
  function driveUrl(value) {
    const url=normalizeUrl(value);
    if(!/^https:\/\/(?:drive\.google\.com\/file\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$)|docs\.google\.com\/(?:document|spreadsheets|presentation|forms)\/d\/[a-zA-Z0-9_-]+(?:[/?#]|$))/.test(url)) throw Error('Вставте HTTPS-посилання на документ Google Drive.');
    return url;
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
      [c.type, types[c.type], c.nonprofit_code, c.catalog_note, c.client_no, c.edrpou_optional, c.legal_name, c.short_name, c.location, c.geography, ...(c.contacts || []), ...(c.sectors || [])].join(' ').toLocaleLowerCase('uk').includes(needle));
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
      if (!index.has(a.client_id)) index.set(a.client_id, { application_count: 0, submitted_count: 0, won_count: 0, requested: {}, awarded: {}, requested_unknown: 0, awarded_unknown: 0, next_deadline: null, last_application: null });
      const s = index.get(a.client_id); s.application_count++;
      if(validDate(a.submission_at)||['submitted','won','rejected'].includes(a.status))s.submitted_count++;
      if(a.status==='won')s.won_count++;
      for (const [field, key] of [['amount', 'requested'], ['award_amount', 'awarded']]) {
        if (typeof a[field] !== 'number' || !Number.isFinite(a[field]) || !a.currency) s[key + '_unknown']++;
        else s[key][a.currency] = (s[key][a.currency] || 0) + a[field];
      }
      if (validDate(a.created_at) && (!s.last_application || Date.parse(a.created_at) > Date.parse(s.last_application))) s.last_application = a.created_at;
      if (!a.archived_at && !['rejected', 'stopped', 'won'].includes(a.status) && validDate(a.deadline) && (dateOnly(a.deadline) ? a.deadline >= calendarDate(new Date(now).toISOString()) : Date.parse(a.deadline) > now) && (!s.next_deadline || dateOrder(a.deadline) < dateOrder(s.next_deadline))) s.next_deadline = a.deadline;
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
    if (!money) return dateOrder(left).localeCompare(dateOrder(right)) * sign;
    // Спочатку незмінні групи наборів валют; усередині — числовий вектор у порядку валют.
    const group = left.join('/').localeCompare(right.join('/'));
    if (group) return group;
    for (const currency of left) if (a[key][currency] !== b[key][currency]) return (a[key][currency] - b[key][currency]) * sign;
    return 0;
  }
  const api = { socialPlatforms, organizationAge, types, statuses, taskStatuses, uuid, dateOnly, calendarDate, dateOrder, driveUrl, validDate, validateClient, validateGrant, normalizeUrl, searchClients, transitionTask, applicationSummaries, compareSummary };
  if (typeof module !== 'undefined') module.exports = api;
  else root.CrmDomain = api;
})(globalThis);
