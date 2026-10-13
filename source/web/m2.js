'use strict';
let crm;
function refreshData() { Object.assign(data, crm.data()); }
async function initializeCrm() { if(globalThis.CRM_REMOTE){crm=new CrmRemote.Service();await crm.reload();}else{crm=new CrmCore.CrmService(new CrmCore.LocalRepository(localStorage));await localWrite(()=>crm.initialize(data));}Object.assign(CrmRegistry.statuses,CrmCore.statuses);refreshData(); }
function confirmAction(message) {
  return new Promise(resolve => {
    const dialog=document.createElement('dialog');
    dialog.innerHTML='<form method="dialog"><h2>Підтвердження видалення</h2><p></p><div class="actions"><button value="cancel" autofocus>Скасувати</button><button value="confirm">Підтвердити видалення</button></div></form>';
    dialog.querySelector('p').textContent=message;
    dialog.addEventListener('close',()=>{const confirmed=dialog.returnValue==='confirm';dialog.remove();resolve(confirmed);},{once:true});
    document.body.append(dialog);dialog.showModal();
  });
}
function field(name,label,value='',kind='input') { return `<label>${label}${kind==='textarea'?`<textarea name="${name}">${escapeHtml(value)}</textarea>`:`<input name="${name}" value="${escapeHtml(value)}">`}</label>`; }
function selectField(name,label,values,value) { return `<label>${label}<select name="${name}">${Object.entries(values).map(([k,v])=>`<option value="${escapeHtml(k)}" ${k===value?'selected':''}>${escapeHtml(v)}</option>`).join('')}</select></label>`; }
async function localWrite(action) {
  if(globalThis.CRM_REMOTE){try{return await action();}finally{showPendingWrite();}}
  if (!navigator.locks) throw Error('Для безпечного запису потрібен браузер із Web Locks та локальний HTTP-запуск.');
  return navigator.locks.request('crm-m2-write', action);
}
function bindForm(save) { const form=main.querySelector('form');form.addEventListener('submit',async event=>{event.preventDefault();const input=Object.fromEntries(new FormData(form));const controls=[...form.elements].map(element=>[element,element.disabled]);controls.forEach(([element])=>element.disabled=true);try {await localWrite(()=>save(input));}catch(error){form.querySelector('#form-result').textContent=error.message;}finally{controls.forEach(([element,disabled])=>element.disabled=disabled);}}); }
const clientState={query:'',type:'',status:'',sort:'client_no',direction:'asc',page:0};
function showClients() {
 main.classList.add('registry-page');
 const columns=[['client_no','Номер'],['legal_name','Назва'],['type','Тип'],['location','Географія'],['sectors','Напрям діяльності'],['status','Статус'],['application_count','Кількість заявок'],['requested','Запитувано'],['awarded','Присуджено'],['next_deadline','Найближчий дедлайн'],['last_application','Остання заявка']];
 main.innerHTML='<div class="registry-toolbar"><a class="button" href="#profile">+ Створити клієнта</a><label class="client-search">Пошук клієнтів<input id="query" type="search" placeholder="Назва, номер, контакт, географія…"></label><button id="client-filter-toggle" class="button secondary" aria-expanded="false" aria-controls="client-filters">Розширені фільтри<span id="active-filters"></span></button></div>'+
 '<div id="client-filters" class="registry-filter-panel" hidden><label>Тип<select id="type"><option value="">Усі типи</option>'+options(D.types)+'</select></label><label>Статус<select id="status"><option value="">Усі статуси</option>'+options(D.statuses)+'</select></label><button id="client-reset" class="button secondary">Скинути фільтри</button></div>'+
 '<div class="registry-title"><h1>Клієнти</h1><span id="count" role="status"></span></div><p class="sr-only" id="clients-help">Натисніть заголовок для сортування або назву клієнта для перегляду. На вузькому екрані прокручуйте таблицю горизонтально.</p><div class="table-scroll" role="region" aria-label="Таблиця клієнтів" aria-describedby="clients-help" tabindex="0"><table class="registry-table clients-table"><caption class="sr-only">Каталог клієнтів</caption><thead><tr>'+columns.map(([key,label])=>'<th scope="col" data-column="'+key+'" aria-sort="none"><button data-sort="'+key+'">'+label+'<span aria-hidden="true"></span></button></th>').join('')+'</tr></thead><tbody id="results"></tbody></table></div><p class="registry-note">Кількість і суми включають архівні заявки; видалені не враховуються. Присуджено — не підтвердження надходження коштів. Сортування сум: набори валют за абеткою, далі числові суми послідовно за валютами; без конвертації. Географія — місце розташування клієнта.</p><div class="actions"><button id="prev">Назад</button><span id="page"></span><button id="next">Далі</button></div>';
 const toggle=main.querySelector('#client-filter-toggle'),panel=main.querySelector('#client-filters');
 toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)main.querySelector('#type').focus();};
 panel.onkeydown=e=>{if(e.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}};
 const update=()=>{
  const result=crm.listClients(clientState);clientState.page=result.page;
  main.querySelector('#count').textContent='Знайдено: '+result.total;
  const active=Number(Boolean(clientState.type))+Number(Boolean(clientState.status));main.querySelector('#active-filters').textContent=active?' ('+active+')':'';
  main.querySelectorAll('[data-column]').forEach(th=>{const selected=th.dataset.column===clientState.sort;th.setAttribute('aria-sort',selected?(clientState.direction==='asc'?'ascending':'descending'):'none');th.querySelector('span').textContent=selected?(clientState.direction==='asc'?' ↑':' ↓'):' ↕';});
  main.querySelector('#results').innerHTML=result.items.map(c=>'<tr class="client-row"><td>'+escapeHtml(c.client_no)+'</td><td><a href="#profile/'+encodeURIComponent(c.id)+'"><strong>'+escapeHtml(c.legal_name)+'</strong></a></td><td>'+escapeHtml(D.types[c.type])+'</td><td>'+escapeHtml(c.location||'Не вказано')+'</td><td>'+escapeHtml(c.sectors?.join(', ')||'Не вказано')+'</td><td>'+escapeHtml(D.statuses[c.status])+'</td><td class="numeric">'+c.application_count+'</td><td>'+escapeHtml(summaryMoney(c,'requested'))+'</td><td>'+escapeHtml(summaryMoney(c,'awarded'))+'</td><td>'+escapeHtml(c.next_deadline?applicationDate(c.next_deadline):'Майбутніх немає')+'</td><td>'+escapeHtml(c.last_application?'Створено '+applicationDate(c.last_application):'Не вказано')+'</td></tr>').join('')||'<tr><td colspan="11" class="empty">Клієнтів не знайдено. Змініть запит або скиньте фільтри.</td></tr>';
  main.querySelector('#page').textContent='Сторінка '+(result.page+1)+' із '+Math.max(1,Math.ceil(result.total/result.limit));main.querySelector('#prev').disabled=result.page===0;main.querySelector('#next').disabled=(result.page+1)*result.limit>=result.total;
 };
 for(const key of ['query','type','status']){const e=main.querySelector('#'+key);e.value=clientState[key];e.oninput=()=>{clientState[key]=e.value;clientState.page=0;update();};}
 main.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{clientState.direction=clientState.sort===b.dataset.sort&&clientState.direction==='asc'?'desc':'asc';clientState.sort=b.dataset.sort;update();});
 main.querySelector('#client-reset').onclick=()=>{for(const key of ['query','type','status']){clientState[key]='';main.querySelector('#'+key).value='';}clientState.page=0;update();};
 main.querySelector('#prev').onclick=()=>{clientState.page--;update();};main.querySelector('#next').onclick=()=>{clientState.page++;update();};update();
}
const overviewFields=[['legal_name','Назва або ім’я'],['type','Тип'],['status','Статус'],['location','Місце розташування'],['sectors','Напрями діяльності']];
const dossierFields=[['short_name','Коротка назва'],['edrpou_optional','ЄДРПОУ'],['website','Вебсайт'],['source','Джерело знайомства'],['priority','Пріоритет'],['next_action_at','Наступна дія (ISO, з часовим поясом)'],['geography','Географія роботи'],['target_groups','Цільові групи'],['funding_needs','Потреби у фінансуванні'],['grants_experience','Грантовий досвід'],['prior_donors','Попередні донори'],['capacity_note','Командна спроможність'],['competencies','Компетенції фізичної особи'],['portfolio','Портфоліо фізичної особи'],['eligibility_notes','Допустимість за програмами'],['description','Опис']];
const priorities={normal:'Звичайний',high:'Високий',low:'Низький'};
function clientFieldValue(c,key){return key==='type'?D.types[c.type]:key==='status'?D.statuses[c.status]:key==='priority'?priorities[c.priority]:key==='sectors'?(c.sectors||[]).join(', '):c[key];}
function summaryMoney(row,key) {
 const entries=Object.entries(row[key]||{}).sort(([a],[b])=>a.localeCompare(b));
 if(!entries.length)return 'Не вказано';
 return entries.map(([currency,value])=>applicationAmount(value,currency)).join(' · ')+(row[key+'_unknown']?' · Частина сум невідома ('+row[key+'_unknown']+')':'');
}
function kyivDateTime(value) {
 return D.validDate(value)?new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(value)):'—';
}
function sortedHistory(rows) {
 return rows.slice().sort((a,b)=>(D.validDate(b.happened_at)?Date.parse(b.happened_at):-Infinity)-(D.validDate(a.happened_at)?Date.parse(a.happened_at):-Infinity));
}
function profileSummary(c) {
 const state=crm.data(),s=D.applicationSummaries(state.applications).get(c.id)||{};
 const last=sortedHistory(state.interactions.filter(r=>r.client_id===c.id))[0];
 return '<dl class="profile-summary">'+[['Статус',D.statuses[c.status]],['Заявок',s.application_count||0],['Остання взаємодія',kyivDateTime(last?.happened_at)],['Найближчий дедлайн',kyivDateTime(s.next_deadline)],['Наступна дія',kyivDateTime(c.next_action_at)]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escapeHtml(value)+'</dd></div>').join('')+'</dl>';
}
function detailsView(c,fields) {
 return '<dl class="profile-details">'+fields.map(([k,l])=>'<div><dt>'+l+'</dt><dd>'+escapeHtml(clientFieldValue(c,k)||'—')+'</dd></div>').join('')+'</dl>';
}
function dossierView(c) {
 const groups=[['Реєстраційні відомості',['short_name','edrpou_optional','website']],['Діяльність і цільові групи',['geography','target_groups']],['Грантовий досвід та потреби',['funding_needs','grants_experience','prior_donors','eligibility_notes']],['Спроможність',['capacity_note','competencies','portfolio']],['Додаткова інформація',['source','priority','description']]];
 return groups.map(([title,keys])=>{const fields=dossierFields.filter(([k])=>keys.includes(k)&&(c.type==='individual'||!['competencies','portfolio'].includes(k))&&String(c[k]??'').trim());return '<section class="dossier-group"><h3>'+title+'</h3>'+(fields.length?detailsView(c,fields):'<p class="muted">Відомості ще не заповнено. <button data-edit-dossier>Редагувати</button></p>')+'</section>';}).join('');
}
function contactLink(value,kind) {
 const valid=kind==='email'?/^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/.test(value||''):/^\+?[\d ()-]{7,24}$/.test(value||'')&&String(value).replace(/\D/g,'').length>=7;
 return valid?'<a href="'+(kind==='email'?'mailto:'+encodeURIComponent(value):'tel:'+value.replace(/[ ()-]/g,''))+'">'+escapeHtml(value)+'</a>':escapeHtml(value||'—');
}
function contactsView(rows) {
 if(!rows.length)return '<p>Записів ще немає.</p>';
 return '<div class="contact-cards">'+rows.map(r=>'<article class="contact-card"><h3>'+escapeHtml(r.full_name)+'</h3><dl>'+[['Посада',escapeHtml(r.role||'—')],['Телефон',contactLink(r.phone,'phone')],['E-mail',contactLink(r.email,'email')],['Бажаний канал',escapeHtml(r.preferred_channel||'—')]].map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+value+'</dd></div>').join('')+'</dl><button data-edit-contact="'+escapeHtml(r.id)+'">Редагувати контакт</button></article>').join('')+'</div>';
}
function historyView(rows) {
 return '<p class="registry-note">Час: Europe/Kyiv. Записи незмінні після створення.</p>'+(sortedHistory(rows).map(r=>'<article class="history-entry"><strong>'+escapeHtml(kyivDateTime(r.happened_at))+' · '+escapeHtml(r.type)+'</strong><p>'+escapeHtml(r.summary)+'</p><p>Наступний крок: '+escapeHtml(r.next_step||'—')+'</p></article>').join('')||'<p>Записів ще немає.</p>');
}
function showProfile(id,initialTab='Огляд') {
 const c=crm.data().clients.find(c=>c.id===id);
 if(c)main.classList.add('client-profile');
 if(id&&!c){main.innerHTML=heading('Клієнта не знайдено','Клієнта видалено або посилання застаріле.','<a href="#clients">До клієнтів</a>');return;}
 main.innerHTML=heading(c?escapeHtml(c.legal_name):'Новий клієнт',c?'№ '+escapeHtml(c.client_no):'Основні дані; розширені відомості можна додати у вкладці «Досьє».','<a href="#clients">До клієнтів</a>')+(c?'<div class="actions"><details id="client-actions"><summary>Дії</summary><div class="action-menu"><button id="archive">'+(c.status==='archived'?'Відновити з архіву':'Архівувати')+'</button><button id="delete-client">Видалити клієнта</button></div></details><a class="button" href="#application/new/'+encodeURIComponent(c.id)+'">+ Заявка клієнта</a></div><div class="tabs" aria-label="Картка клієнта">'+['Огляд','Досьє','Контакти','Історія','Заявки'].map(t=>'<button data-tab="'+t+'">'+t+'</button>').join('')+'</div>':'')+(c?profileSummary(c):'')+'<section class="panel" id="profile-content"></section>';
 const menu=main.querySelector('#client-actions');if(menu)menu.onkeydown=e=>{if(e.key==='Escape'){menu.open=false;menu.querySelector('summary').focus();}};
 const show=(tab,editing=false,contact=null)=>{
  main.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
  const content=main.querySelector('#profile-content');
  if(tab==='Огляд'||tab==='Досьє'){
   const fields=(tab==='Огляд'?overviewFields:dossierFields).filter(([k])=>c?.type==='individual'||!['competencies','portfolio'].includes(k));
   if(c&&!editing){
    content.innerHTML='<div class="actions"><h2>'+tab+'</h2><button id="edit-client" class="button secondary">Редагувати</button></div>'+(tab==='Досьє'?dossierView(c):detailsView(c,fields));
    content.querySelectorAll('#edit-client,[data-edit-dossier]').forEach(b=>b.onclick=()=>show(tab,true));return;
   }
   content.innerHTML='<h2>'+(c?'Редагування: '+tab:'Основні дані')+'</h2><form><div class="form-grid">'+fields.map(([k,l])=>k==='type'?selectField(k,l,D.types,c?.type||'ngo'):k==='status'?selectField(k,l,D.statuses,c?.status||'potential'):k==='priority'?selectField(k,l,priorities,c?.priority||'normal'):field(k,l+(k==='legal_name'?' *':k==='sectors'?' (через кому)':''),k==='sectors'?c?.sectors?.join(', '):c?.[k],['description','funding_needs','grants_experience'].includes(k)?'textarea':'input')).join('')+'</div><div class="actions"><button class="button">Зберегти клієнта</button><button type="button" id="cancel-edit">Скасувати</button></div><p id="form-result" class="error" role="alert"></p></form>';
   content.querySelector('#cancel-edit').onclick=()=>c?show(tab):location.hash='clients';
   bindForm(async input=>{
    if(Object.hasOwn(input,'sectors'))input.sectors=input.sectors.split(',').map(s=>s.trim()).filter(Boolean);
    // При редагуванні вкладки передаємо обов’язкові поля; решту зберігає наявний сервіс.
    const payload=c?{legal_name:c.legal_name,type:c.type,status:c.status,...input}:input;
    const saved=await crm.saveClient(payload,c?.id,c?.version);refreshData();
    if(c)showProfile(saved.id,tab);else location.hash='profile/'+saved.id;
   });
  }else if(tab==='Заявки'){
   showClientApplications(content,id);
  }else{
   const contacts=tab==='Контакти',table=contacts?'contacts':'interactions';
   const fields=contacts?[['full_name','Ім’я *'],['role','Роль'],['email','Електронна адреса'],['phone','Телефон'],['preferred_channel','Бажаний канал']]:[['happened_at','Дата і час із поясом *'],['summary','Підсумок *'],['next_step','Наступний крок']];
   const related=crm.data()[table].filter(r=>r.client_id===id);
   content.innerHTML='<h2>'+tab+'</h2>'+(contacts?contactsView(related):historyView(related));
   if(!editing){content.innerHTML+='<button id="add-related" class="button secondary">'+(contacts?'Додати контакт':'Додати взаємодію')+'</button>';content.querySelector('#add-related').onclick=()=>show(tab,true);content.querySelectorAll('[data-edit-contact]').forEach(b=>b.onclick=()=>show(tab,true,related.find(r=>r.id===b.dataset.editContact)));return;}
   content.innerHTML='<h2>'+tab+'</h2><form><div class="form-grid">'+(contacts?'':selectField('type','Вид взаємодії',{'Дзвінок':'Дзвінок','Зустріч':'Зустріч','Лист':'Лист','Повідомлення':'Повідомлення','Рекомендація':'Рекомендація','Передача документів':'Передача документів'},'Дзвінок'))+fields.map(([k,l])=>field(k,l,contact?.[k]??(k==='happened_at'?new Date().toISOString():''))).join('')+'</div><div class="actions"><button class="button">'+(contact?'Зберегти контакт':'Додати запис')+'</button><button id="cancel-related" type="button">Скасувати</button></div><p id="form-result" class="error" role="alert"></p></form>';
   content.querySelector('#cancel-related').onclick=()=>show(tab);
   content.querySelector('form input,form select')?.focus();
   bindForm(async input=>{if(contact)await crm.saveContact({...input,client_id:id},contact.id,contact.version||1);else await crm.addRelated(table,{...input,client_id:id});refreshData();showProfile(id,tab);});
  }
 };
 main.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab));
 if(c){main.querySelector('#archive').onclick=async()=>{try{await localWrite(()=>crm.clientAction(id,c.status==='archived'?'restore':'archive'));refreshData();showProfile(id);}catch(e){alert(e.message);}};main.querySelector('#delete-client').onclick=async()=>{if(await confirmAction('Видалити клієнта? Його заявки також буде приховано з реєстру. Дані та зв’язки залишаться у сховищі.'))try{await localWrite(()=>crm.clientAction(id,'delete',true));refreshData();location.hash='clients';}catch(e){alert(e.message);}};}
 show(initialTab);
}
function applicationDate(value) {
 return value && Number.isFinite(Date.parse(value)) ? new Intl.DateTimeFormat('uk-UA',{timeZone:'Europe/Kyiv'}).format(new Date(value)) : 'Не вказано';
}
function applicationAmount(value,currency) {
 return (value == null ? 'Не вказано' : new Intl.NumberFormat('uk-UA',{maximumFractionDigits:2}).format(value))+' '+(currency||'');
}
function showClientApplications(content,id) {
 const rows=crm.data().applications.filter(a=>a.client_id===id&&!a.deleted_at);
 const state={clientId:id,sort:'application_no',direction:'asc'};
 const columns=[['application_no','Номер заявки'],['title','Назва'],['grant','Грант / донор'],['submission_at','Дата подання'],['deadline','Дедлайн'],['amount','Запитувана сума / валюта'],['status','Статус']];
 content.innerHTML='<div class="actions"><h2>Заявки</h2><a class="button" href="#application/new/'+encodeURIComponent(id)+'">+ Додати заявку</a></div><div class="application-counts" aria-label="Кількість заявок за статусами">'+Object.entries(CrmCore.statuses).map(([key,label])=>'<span>'+escapeHtml(label)+': <strong>'+rows.filter(a=>a.status===key).length+'</strong></span>').join('')+'</div><p class="registry-note">Усього: '+rows.length+'. Архівні враховано; видалені не показуються. Дати: Europe/Kyiv. Суми сортуються в межах валюти без конвертації.</p><div class="table-scroll" role="region" aria-label="Заявки клієнта" tabindex="0"><table class="registry-table client-applications"><caption class="sr-only">Заявки клієнта. Натисніть назву для перегляду, заголовок — для сортування.</caption><thead><tr>'+columns.map(([key,label])=>'<th scope="col" data-column="'+key+'" aria-sort="none"><button data-sort="'+key+'">'+label+'<span aria-hidden="true"></span></button></th>').join('')+'</tr></thead><tbody></tbody></table></div>';
 const update=()=>{
  content.querySelectorAll('[data-column]').forEach(th=>{const selected=th.dataset.column===state.sort;th.setAttribute('aria-sort',selected?(state.direction==='asc'?'ascending':'descending'):'none');th.querySelector('span').textContent=selected?(state.direction==='asc'?' ↑':' ↓'):' ↕';});
  content.querySelector('tbody').innerHTML=CrmRegistry.select(rows,data.clients,state).map(a=>'<tr class="application-row '+(Object.hasOwn(CrmCore.statuses,a.status)?a.status:'')+'"><td>'+escapeHtml(a.application_no)+'</td><td><a href="#application/'+encodeURIComponent(a.id)+'">'+escapeHtml(a.title)+'</a></td><td>'+escapeHtml(a.grant)+'<small>'+escapeHtml(a.donor)+'</small></td><td>'+applicationDate(a.submission_at)+'</td><td>'+applicationDate(a.deadline)+'</td><td class="numeric">'+escapeHtml(applicationAmount(a.amount,a.currency))+'</td><td>'+escapeHtml(CrmCore.statuses[a.status])+(a.archived_at?'<small>Архів</small>':'')+'</td></tr>').join('')||'<tr><td colspan="7" class="empty">Заявок ще немає.</td></tr>';
 };
 content.querySelectorAll('[data-sort]').forEach(b=>b.onclick=()=>{state.direction=state.sort===b.dataset.sort&&state.direction==='asc'?'desc':'asc';state.sort=b.dataset.sort;update();});
 update();
}
function application(id,clientId,editing=false) {
 const a=crm.data().applications.find(a=>a.id===id);if(id&&id!=='new'&&!a){main.innerHTML=heading('Заявку не знайдено','Оберіть заявку в реєстрі.');return;}
 if(a&&!editing){
  const client=data.clients.find(c=>c.id===a.client_id);
  const fields=[['Номер заявки',a.application_no],['Назва',a.title],['Клієнт',client?.legal_name],['Грант',a.grant],['Донор',a.donor],['Дата подання',applicationDate(a.submission_at)],['Дедлайн',applicationDate(a.deadline)],['Запитувана сума',applicationAmount(a.amount,a.currency)],['Присуджена сума',applicationAmount(a.award_amount,a.currency)],['Статус',CrmCore.statuses[a.status]],['Архів',a.archived_at?'Так':'Ні'],['Дата відповіді',applicationDate(a.donor_reply_at)],['Примітки / результат',a.notes]];
  main.innerHTML=heading('Перегляд заявки','Дати: Europe/Kyiv. Суми в початковій валюті.')+'<section class="panel"><div class="actions"><button id="edit-application" class="button">Редагувати</button><a href="#profile/'+encodeURIComponent(a.client_id)+'">До клієнта</a><a href="#home">До реєстру</a></div><dl class="profile-details">'+fields.map(([label,value])=>'<div><dt>'+label+'</dt><dd>'+escapeHtml(value??'Не вказано')+'</dd></div>').join('')+'</dl></section>';
  main.querySelector('#edit-application').onclick=()=>application(id,clientId,true);return;
 }
 main.innerHTML=heading(a?'Редагування заявки':'Нова заявка','Дати: ISO 8601 із часовим поясом; порожня сума означає невідому.')+`<section class="panel"><form><div class="form-grid">${selectField('client_id','Клієнт *',Object.fromEntries(data.clients.map(c=>[c.id,c.legal_name])),a?.client_id||clientId)}${selectField('status','Статус',CrmCore.statuses,a?.status||'preparation')}${field('title','Назва заявки *',a?.title)}${field('grant','Грант *',a?.grant)}${field('donor','Донор *',a?.donor)}${field('deadline','Дедлайн (ISO із поясом)',a?.deadline)}${field('amount','Запитувана сума',a?.amount)}${field('award_amount','Присуджена сума',a?.award_amount)}${selectField('currency','Валюта',{EUR:'EUR',UAH:'UAH',USD:'USD',GBP:'GBP'},a?.currency||'EUR')}${field('submission_at','Дата подання (ISO із поясом)',a?.submission_at)}${field('donor_reply_at','Дата відповіді (ISO із поясом)',a?.donor_reply_at)}${field('notes','Примітки / результат',a?.notes,'textarea')}</div><button class="button">Зберегти заявку</button><a href="#home">До реєстру</a><p id="form-result" class="error" role="alert"></p></form>${a?`<button id="archive-application">${a.archived_at?'Відновити з архіву':'Архівувати'}</button>`+'<button id="delete-application">Видалити заявку</button>':''}</section>`;
 bindForm(async input=>{for(const k of ['amount','award_amount'])input[k]=input[k].trim()===''?null:Number(input[k]);await crm.saveApplication(input,a?.id,a?.version);refreshData();location.hash='home';});
 if(a)main.querySelector('#archive-application').onclick=async()=>{try{await localWrite(()=>crm.applicationAction(a.id,a.archived_at?'restore':'archive'));refreshData();application(a.id,clientId,true);}catch(e){main.querySelector('#form-result').textContent=e.message;}};
 if(a)main.querySelector('#delete-application').onclick=async()=>{if(await confirmAction('Видалити цю заявку з реєстру?'))try{await localWrite(()=>crm.deleteApplication(a.id,true));refreshData();location.hash='home';}catch(e){main.querySelector('#form-result').textContent=e.message;}};
}

function showPendingWrite(){
 let notice=document.querySelector('#pending-write');
 if(!crm.pending){notice?.remove();return;}
 if(!notice){notice=document.createElement('div');notice.id='pending-write';notice.className='notice';document.querySelector('.workspace').prepend(notice);}
 notice.innerHTML='<p role="alert">Запис очікує підтвердження. Не закривайте сторінку. Кнопка повторить початковий запит, навіть якщо поля форми змінено.</p><button>Перевірити / повторити початковий запис</button>';
 notice.querySelector('button').onclick=async event=>{event.target.disabled=true;try{const {action,args}=JSON.parse(crm.pending.signature);await crm.mutate(action,args);refreshData();render();}catch(error){alert(error.message);}finally{showPendingWrite();}};
}
window.addEventListener('beforeunload',event=>{if(crm?.pending){event.preventDefault();event.returnValue='';}});
document.addEventListener('click',event=>{if(crm?.busy&&event.target.closest('a,button')){event.preventDefault();event.stopImmediatePropagation();}},true);
