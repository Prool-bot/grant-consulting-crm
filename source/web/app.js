'use strict';
const D = CrmDomain, data = CrmDemo, main = document.querySelector('main');
document.querySelector('.skip').addEventListener('click', event => { event.preventDefault(); main.focus(); main.scrollIntoView(); });
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const date = value => new Intl.DateTimeFormat('uk-UA', { day: 'numeric', month: 'long', timeZone: 'Europe/Kyiv' }).format(new Date(value + 'T12:00:00+03:00'));
const options = object => Object.entries(object).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
function heading(title, subtitle, action = '') { return `<div class="heading"><div><div class="eyebrow">Каталог клієнтів</div><h1>${title}</h1><p class="muted">${subtitle}</p></div>${action}</div>`; }
function taskRows(tasks) { return tasks.length ? tasks.map(t => `<div class="row"><div><h3>${escapeHtml(t.title)}</h3><p>${escapeHtml(t.client)} · ${date(t.date)}</p></div><span class="badge ${t.date < data.today ? 'warning' : ''}">${D.taskStatuses[t.status]}${t.date < data.today ? ' · Прострочено' : ''}</span></div>`).join('') : '<p class="empty">Завдань за цим фільтром немає.</p>'; }
function home() { registry(); }
function tasks() {
  main.innerHTML = heading('Завдання', 'Наступні кроки та терміни · календар не підключений') + `<div class="filters"><label>Період<select id="period"><option value="all">Усі завдання</option><option value="today">Сьогодні</option><option value="overdue">Прострочено</option><option value="week">Наступні 7 днів</option></select></label></div><section class="panel" id="task-list" aria-live="polite"></section>`;
  const update = () => { const period = document.querySelector('#period').value; document.querySelector('#task-list').innerHTML = taskRows(data.tasks.filter(t => period === 'all' || (period === 'today' && t.date === data.today) || (period === 'overdue' && t.date < data.today) || (period === 'week' && t.date >= data.today && t.date < '2026-10-19'))); };
  document.querySelector('#period').addEventListener('change', update); update();
}
function grants() {
  main.innerHTML = heading('Грантові можливості', 'Вигадані конкурси для демонстрації структури каталогу') + `<div class="cards">${data.grants.map(g => `<article class="card"><span class="badge">${g.sector}</span><h2 style="margin-top:18px">${g.title}</h2><p>${g.donor}</p><strong>${g.amount == null ? 'Суму не вказано' : new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(g.amount)}</strong><p>Заявники: ${g.applicants}</p><div class="meta"><span>Дедлайн: ${date(g.deadline)}</span><span>Europe/Kyiv</span></div><div class="notice">Демонстрація · першоджерело відсутнє, актуальність не перевірена.</div></article>`).join('')}</div>`;
}
function render() {
  main.classList.remove('registry-page');
  const [route, id, clientId] = location.hash.slice(1).split('/');
  document.querySelectorAll('nav a').forEach(a => { if (a.hash === '#' + (route || 'home')) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  ({ home, clients: showClients, profile: () => showProfile(id), application: () => application(id, clientId), tasks, grants }[route || 'home'] || (() => { main.innerHTML = heading('Сторінку не знайдено', 'Скористайтеся основною навігацією.'); }))();
  document.title = `${main.querySelector('h1').textContent} — Каталог клієнтів`;
}
window.addEventListener('hashchange', () => { render(); main.focus(); }); initializeCrm().then(render).catch(() => { main.innerHTML = '<h1>Локальне сховище недоступне</h1><p>Дані не перезаписано. Перевірте доступ браузера до сховища або збережіть його копію перед відновленням. Запускайте через локальний HTTP-сервер у сучасному браузері.</p>'; });
