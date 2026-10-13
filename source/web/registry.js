'use strict';
const registryState = { query: '', clientId: '', status: '', sort: 'deadline', direction: 'asc', grouped: true, archived: false };
function registry() {
  main.classList.add('registry-page');
  main.innerHTML = `
    <div class="registry-toolbar">
      <a class="button" href="#application/new">+ Додати заявку</a>
      <select id="application-client" aria-label="Клієнт"><option value="">Усі клієнти</option>${data.clients.map(c => `<option value="${c.id}">${escapeHtml(c.legal_name)}</option>`).join('')}</select>
      <button id="filter-toggle" class="button secondary" aria-expanded="false" aria-controls="application-filters">🔍 Пошук і фільтри<span id="active-filters"></span></button>
      <label class="check-label"><input id="application-archive" type="checkbox"> Архів заявок</label><button id="reload-data">Оновити дані</button><label class="check-label"><input id="application-group" type="checkbox"> Групувати за клієнтами</label>
    </div>
    <div id="application-filters" class="registry-filter-panel" hidden>
      <label>Пошук заявок<input id="application-query" type="search" placeholder="Заявка, клієнт, грант, донор…"></label>
      <label>Статус заявки<select id="application-status"><option value="">Усі статуси</option>${options(CrmRegistry.statuses)}</select></label>
      <button id="application-reset" class="button secondary">Скинути фільтри</button>
    </div>
    <div class="registry-title"><h1>Реєстр грантових заявок</h1><span id="application-count" role="status"></span></div>
    <p class="sr-only" id="table-help">Натисніть заголовок стовпця для сортування. На вузькому екрані прокручуйте таблицю горизонтально.</p>
    <div class="table-scroll" role="region" aria-label="Таблиця заявок" aria-describedby="table-help" tabindex="0"><table class="registry-table"><caption class="sr-only">Грантові заявки</caption><thead><tr>${[['title','Заявка'],['client','Клієнт / досьє'],['grant','Грант / донор'],['deadline','Дедлайн'],['amount','Сума / валюта'],['status','Статус']].map(([key, title]) => `<th scope="col" data-column="${key}" aria-sort="none"><button data-sort="${key}">${title}<span aria-hidden="true"></span></button></th>`).join('')}</tr></thead><tbody id="application-rows"></tbody></table></div><p class="registry-note">${globalThis.CRM_REMOTE?'CRM 1.0 · Google Sheets · доступ лише власнику':'Локальна демонстрація · лише вигадані дані'}</p>`;
  const query = document.querySelector('#application-query'), client = document.querySelector('#application-client'), status = document.querySelector('#application-status'), group = document.querySelector('#application-group');
  query.value = registryState.query; client.value = registryState.clientId; status.value = registryState.status; group.checked = registryState.grouped;
  const toggle = document.querySelector('#filter-toggle'), panel = document.querySelector('#application-filters');
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) query.focus();
  });
  panel.addEventListener('keydown', event => {
    if (event.key === 'Escape') { panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); toggle.focus(); }
  });
  const update = () => {
    const active = Number(Boolean(registryState.query)) + Number(Boolean(registryState.status));
    document.querySelector('#active-filters').textContent = active ? ' (' + active + ')' : '';
    if (registryState.clientId && !data.clients.some(c=>c.id===registryState.clientId)) {registryState.clientId='';client.value='';}
    const rows = CrmRegistry.select(data.applications.filter(a=>Boolean(a.archived_at)===registryState.archived), data.clients, registryState);
    document.querySelector('#application-count').textContent = `Показано ${rows.length} із ${data.applications.length}`;
    main.querySelectorAll('[data-column]').forEach(th => {
      const selected = th.dataset.column === registryState.sort;
      th.setAttribute('aria-sort', selected ? registryState.direction === 'asc' ? 'ascending' : 'descending' : 'none');
      th.querySelector('span').textContent = selected ? registryState.direction === 'asc' ? ' ↑' : ' ↓' : ' ↕';
    });
    let previousClient;
    document.querySelector('#application-rows').innerHTML = rows.length ? rows.map(row => {
      let header = '';
      if (registryState.grouped && row.client_id !== previousClient) {
        header = `<tr class="client-group"><th colspan="6"><a href="#profile/${row.client_id}">${escapeHtml(row.client)}</a> <span>· Заявок: ${rows.filter(r => r.client_id === row.client_id).length}</span></th></tr>`;
        previousClient = row.client_id;
      }
      return header + `<tr class="application-row ${row.status}"><td><a href="#application/${row.id}"><strong>${escapeHtml(row.title)}</strong></a><small>${escapeHtml(row.application_no)}</small></td><td><a href="#profile/${row.client_id}">${escapeHtml(row.client)}</a></td><td>${escapeHtml(row.grant)}<small>${escapeHtml(row.donor)}</small></td><td>${row.deadline ? escapeHtml(new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv' }).format(new Date(row.deadline))) : 'Не вказано'}<small>Europe/Kyiv</small></td><td class="numeric">${row.amount == null ? 'Не вказано' : new Intl.NumberFormat('uk-UA').format(row.amount)} <small>${escapeHtml(row.currency || "EUR")}</small></td><td>${CrmRegistry.statuses[row.status]}</td></tr>`;
    }).join('') : '<tr><td colspan="6" class="empty">Заявок не знайдено. Змініть запит або скиньте фільтри.</td></tr>';
  };
  for (const [element, key] of [[query, 'query'], [client, 'clientId'], [status, 'status']]) element.addEventListener('input', () => { registryState[key] = element.value; update(); });
  group.addEventListener('change', () => { registryState.grouped = group.checked; update(); });
  main.querySelectorAll('[data-sort]').forEach(button => button.addEventListener('click', () => {
    registryState.direction = registryState.sort === button.dataset.sort && registryState.direction === 'asc' ? 'desc' : 'asc';
    registryState.sort = button.dataset.sort; update();
  }));
  document.querySelector('#application-reset').addEventListener('click', () => {
    registryState.query = registryState.clientId = registryState.status = '';
    query.value = client.value = status.value = ''; update();
  });
  const archive=main.querySelector('#application-archive');archive.checked=registryState.archived;archive.onchange=()=>{registryState.archived=archive.checked;update();};
  main.querySelector('#reload-data').onclick=async event=>{event.target.disabled=true;try{if(crm.reload)await crm.reload();refreshData();registry();}catch{alert('Не вдалося оновити дані. Спробуйте ще раз.');event.target.disabled=false;}};
  update();
}
