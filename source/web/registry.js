'use strict';
const registryState = { query: '', clientId: '', status: '', sort: 'deadline', direction: 'asc', grouped: true };
function registry() {
  main.innerHTML = heading('Реєстр грантових заявок', 'Заявки, клієнти й терміни — в одному реєстрі.') + `
    <div class="notice">М1 · вигадані дані, лише перегляд. Збереження та інтеграції вимкнені.</div>
    <div class="registry-actions" aria-label="Майбутні можливості">
      <button disabled>+ Ввести заявку</button><button disabled>Оновити з Google Sheets</button><button disabled>Імпорт Excel / CSV</button>
      <span class="muted">Доступні на наступних етапах</span>
    </div>
    <div class="filters registry-filters">
      <label>Пошук заявок<input id="application-query" type="search" placeholder="Заявка, клієнт, грант, донор…"></label>
      <label>Клієнт<select id="application-client"><option value="">Усі клієнти</option>${data.clients.map(c => `<option value="${c.id}">${escapeHtml(c.legal_name)}</option>`).join('')}</select></label>
      <label>Статус заявки<select id="application-status"><option value="">Усі статуси</option>${options(CrmRegistry.statuses)}</select></label>
    </div>
    <div class="registry-tools"><label class="check-label"><input id="application-group" type="checkbox"> Групувати за клієнтами</label><button id="application-reset" class="button secondary">Скинути фільтри</button><span id="application-count" role="status"></span></div>
    <div class="legend" aria-label="Позначення статусів"><span><i class="submitted"></i>Подано · очікуємо рішення</span><span><i class="rejected"></i>Відхилено</span><span><i></i>У роботі</span></div>
    <p class="muted table-hint" id="table-help">Натисніть заголовок стовпця для сортування. На вузькому екрані прокручуйте таблицю горизонтально.</p>
    <div class="table-scroll" role="region" aria-label="Таблиця заявок" aria-describedby="table-help" tabindex="0"><table class="registry-table"><caption>Демонстраційні грантові заявки · суми в EUR</caption><thead><tr>${[['title','Заявка'],['client','Клієнт / досьє'],['grant','Грант / донор'],['deadline','Дедлайн'],['amount','Сума, EUR'],['status','Статус']].map(([key, title]) => `<th scope="col" data-column="${key}" aria-sort="none"><button data-sort="${key}">${title}<span aria-hidden="true"></span></button></th>`).join('')}</tr></thead><tbody id="application-rows"></tbody></table></div>`;
  const query = document.querySelector('#application-query'), client = document.querySelector('#application-client'), status = document.querySelector('#application-status'), group = document.querySelector('#application-group');
  query.value = registryState.query; client.value = registryState.clientId; status.value = registryState.status; group.checked = registryState.grouped;
  const update = () => {
    const rows = CrmRegistry.select(data.applications, data.clients, registryState);
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
      return header + `<tr class="application-row ${row.status}"><td><strong>${escapeHtml(row.title)}</strong><small>${escapeHtml(row.application_no)}</small></td><td><a href="#profile/${row.client_id}">${escapeHtml(row.client)}</a></td><td>${escapeHtml(row.grant)}<small>${escapeHtml(row.donor)}</small></td><td>${row.deadline ? escapeHtml(new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv' }).format(new Date(row.deadline))) : 'Не вказано'}<small>Europe/Kyiv</small></td><td class="numeric">${row.amount == null ? 'Не вказано' : new Intl.NumberFormat('uk-UA').format(row.amount)}</td><td>${CrmRegistry.statuses[row.status]}</td></tr>`;
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
  update();
}
