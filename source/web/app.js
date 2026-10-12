'use strict';
const D = CrmDomain, data = CrmDemo, main = document.querySelector('main');
document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); main.focus(); main.scrollIntoView(); });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'Europe/Kyiv' }).format(new Date(value + 'T12:00:00+03:00'));
const options = object => Object.entries(object).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
function heading(title, subtitle, action = '') { return `<div class="heading"><div><div class="eyebrow">Каталог клієнтів</div><h1>${title}</h1><p class="muted">${subtitle}</p></div>${action}</div>`; }
function taskRows(tasks) { return tasks.length ? tasks.map(t => `<div class="row"><div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.client)} · ${date(t.date)}</p></div><span class="badge ${t.date < data.today ? 'warning' : ''}">${D.taskStatuses[t.status]}${t.date < data.today ? ' · Прострочено' : ''}</span></div>`).join('') : '<p class="empty">Завдань за цим фільтром немає.</p>'; }
function home() { registry(); }
function clients() {
  main.innerHTML = heading('Клієнти', 'Знаходьте клієнтів за назвою, контактом, географією або напрямом.', '<a class="button" href="#profile">+ Картка клієнта</a>') + `<div class="filters"><label>Пошук<input id="query" type="search" placeholder="Назва, контакт, напрям…"></label><label>Тип<select id="type"><option value="">Усі типи</option>${options(D.types)}</select></label><label>Статус<select id="status"><option value="">Усі статуси</option>${options(D.statuses)}</select></label></div><p id="count" role="status"></p><section id="results" class="panel" aria-label="Список клієнтів"></section>`;
  const update = () => {
    const rows = D.searchClients(data.clients, { query: document.querySelector('#query').value, type: document.querySelector('#type').value, status: document.querySelector('#status').value });
    document.querySelector('#count').textContent = `Знайдено клієнтів: ${rows.length}`;
    document.querySelector('#results').innerHTML = rows.length ? rows.map(c => `<div class="row"><div><a href="#profile/${c.id}">${escapeHtml(c.legal_name)}</a><p>№ ${c.client_no} · ${D.types[c.type]} · ${escapeHtml(c.location)} · ${escapeHtml(c.sectors.join(', '))}</p></div><span class="badge">${D.statuses[c.status]}</span></div>`).join('') : '<p class="empty">Нічого не знайдено. Спробуйте інший запит або скиньте фільтри.</p>';
  };
  main.querySelectorAll('input,select').forEach(el => el.addEventListener('input', update)); update();
}
function profile(id) {
  const client = data.clients.find(c => c.id === id);
  if (id && !client) { main.innerHTML = heading('Досьє не знайдено', 'Перейдіть до каталогу та оберіть демонстраційного клієнта.', '<a href="#clients">Клієнти →</a>'); return; }
  main.innerHTML = heading(client ? escapeHtml(client.legal_name) : 'Нова картка клієнта', client ? 'Демонстраційне досьє · лише перегляд' : 'Порожня форма для перевірки полів · без збереження') +
    `<div class="tabs" aria-label="Розділи досьє">${['Профіль', 'Контакти', 'Історія', 'Завдання', 'Гранти', 'Заявки', 'Документи', 'Фінанси'].map((t, i) => `<button type="button" aria-pressed="${i === 0}" data-tab="${t}">${t}</button>`).join('')}</div><section class="panel" id="profile-content"></section>`;
  const show = tab => {
    const content = document.querySelector('#profile-content');
    if (tab !== 'Профіль') { content.innerHTML = `<h2>${tab}</h2><p class="empty">Розділ ще не реалізовано у М1. Реальні дані та інтеграції відсутні.</p>`; return; }
    content.innerHTML = `<form id="client-form" novalidate><div class="form-grid"><label>Тип клієнта<select name="type">${options(D.types)}</select></label><label>Статус<select name="status">${options(D.statuses)}</select></label><label class="full">Назва або ім’я *<input name="legal_name" required value="${escapeHtml(client?.legal_name)}"></label><label>Географія<input name="location" value="${escapeHtml(client?.location)}"></label><label id="code-label">Код ЄДРПОУ (необов’язково)<input name="edrpou_optional" inputmode="numeric"></label><label class="full"><span id="description-label">Потреби та спроможність організації</span><textarea name="description">${escapeHtml(client?.description)}</textarea></label></div><div class="notice">Не вводьте реальні персональні дані. Значення зникають після переходу на інший екран.</div>${client ? '' : '<button class="button" type="submit">Перевірити поля</button>'}<p id="form-result" role="status"></p></form>`;
    const form = document.querySelector('form');
    form.elements.type.value = client?.type || 'ngo'; form.elements.status.value = client?.status || 'potential';
    const changeType = () => { const individual = form.elements.type.value === 'individual'; document.querySelector('#code-label').hidden = individual; document.querySelector('#description-label').textContent = individual ? 'Компетенції, портфоліо та потреби у фінансуванні' : 'Потреби та спроможність організації'; };
    form.elements.type.addEventListener('change', changeType); changeType();
    if (client) form.querySelectorAll('input,select,textarea').forEach(el => el.disabled = true);
    form.addEventListener('submit', event => { event.preventDefault(); const errors = D.validateClient(Object.fromEntries(new FormData(form))); const result = document.querySelector('#form-result'); result.className = Object.keys(errors).length ? 'error' : ''; result.textContent = Object.values(errors).join(' ') || 'Поля коректні. Це прототип — картку не збережено.'; form.querySelectorAll('[aria-invalid]').forEach(el => el.removeAttribute('aria-invalid')); for (const key of Object.keys(errors)) form.elements[key]?.setAttribute('aria-invalid', 'true'); if (Object.keys(errors).length) form.elements[Object.keys(errors)[0]].focus(); });
  };
  main.querySelectorAll('[data-tab]').forEach(button => button.addEventListener('click', () => { main.querySelectorAll('[data-tab]').forEach(b => b.setAttribute('aria-pressed', String(b === button))); show(button.dataset.tab); })); show('Профіль');
}
function tasks() {
  main.innerHTML = heading('Завдання', 'Наступні кроки та терміни · календар не підключений') + `<div class="filters"><label>Період<select id="period"><option value="all">Усі завдання</option><option value="today">Сьогодні</option><option value="overdue">Прострочено</option><option value="week">Наступні 7 днів</option></select></label></div><section class="panel" id="task-list" aria-live="polite"></section>`;
  const update = () => { const period = document.querySelector('#period').value; document.querySelector('#task-list').innerHTML = taskRows(data.tasks.filter(t => period === 'all' || (period === 'today' && t.date === data.today) || (period === 'overdue' && t.date < data.today) || (period === 'week' && t.date >= data.today && t.date < '2026-10-19'))); };
  document.querySelector('#period').addEventListener('change', update); update();
}
function grants() {
  main.innerHTML = heading('Грантові можливості', 'Вигадані конкурси для демонстрації структури каталогу') + `<div class="cards">${data.grants.map(g => `<article class="card"><span class="badge">${g.sector}</span><h2 style="margin-top:18px">${g.title}</h2><p>${g.donor}</p><strong>${g.amount == null ? 'Суму не вказано' : new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(g.amount)}</strong><p>Заявники: ${g.applicants}</p><div class="meta"><span>Дедлайн: ${date(g.deadline)}</span><span>Europe/Kyiv</span></div><div class="notice">Демонстрація · першоджерело відсутнє, актуальність не перевірена.</div></article>`).join('')}</div>`;
}
function render() {
  const [route, id] = location.hash.slice(1).split('/');
  document.querySelectorAll('nav a').forEach(a => { if (a.hash === '#' + (route || 'home')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  ({ home, clients, profile: () => profile(id), tasks, grants }[route || 'home'] || (() => { main.innerHTML = heading('Сторінку не знайдено', 'Скористайтеся основною навігацією.'); }))();
  document.title = `${main.querySelector('h1').textContent} — Каталог клієнтів`;
}
window.addEventListener('hashchange', () => { render(); main.focus(); }); render();
