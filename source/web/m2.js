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
 const columns=[['client_no','Номер'],['legal_name','Назва'],['type','Тип'],['location','Географія'],['sectors','Напрям діяльності'],['status','Статус'],['application_count','Кількість заявок']];
 main.innerHTML='<div class="registry-toolbar"><a class="button" href="#profile">+ Створити клієнта</a><label class="client-search">Пошук клієнтів<input id="query" type="search" placeholder="Назва, номер, контакт, географія…"></label><button id="client-filter-toggle" class="button secondary" aria-expanded="false" aria-controls="client-filters">Розширені фільтри<span id="active-filters"></span></button></div>'+
 '<div id="client-filters" class="registry-filter-panel" hidden><label>Тип<select id="type"><option value="">Усі типи</option>'+options(D.types)+'</select></label><label>Статус<select id="status"><option value="">Усі статуси</option>'+options(D.statuses)+'</select></label><button id="client-reset" class="button secondary">Скинути фільтри</button></div>'+
 '<div class="registry-title"><h1>Клієнти</h1><span id="count" role="status"></span></div><p class="sr-only" id="clients-help">Натисніть заголовок для сортування або назву клієнта для перегляду. На вузькому екрані прокручуйте таблицю горизонтально.</p><div class="table-scroll" role="region" aria-label="Таблиця клієнтів" aria-describedby="clients-help" tabindex="0"><table class="registry-table clients-table"><caption class="sr-only">Каталог клієнтів</caption><thead><tr>'+columns.map(([key,label])=>'<th scope="col" data-column="'+key+'" aria-sort="none"><button data-sort="'+key+'">'+label+'<span aria-hidden="true"></span></button></th>').join('')+'</tr></thead><tbody id="results"></tbody></table></div><p class="registry-note">Кількість заявок включає архівні; видалені не враховуються. Географія — місце розташування клієнта.</p><div class="actions"><button id="prev">Назад</button><span id="page"></span><button id="next">Далі</button></div>';
 const toggle=main.querySelector('#client-filter-toggle'),panel=main.querySelector('#client-filters');
 toggle.onclick=()=>{panel.hidden=!panel.hidden;toggle.setAttribute('aria-expanded',String(!panel.hidden));if(!panel.hidden)main.querySelector('#type').focus();};
 panel.onkeydown=e=>{if(e.key==='Escape'){panel.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();}};
 const update=()=>{
  const result=crm.listClients(clientState);clientState.page=result.page;
  main.querySelector('#count').textContent='Знайдено: '+result.total;
  const active=Number(Boolean(clientState.type))+Number(Boolean(clientState.status));main.querySelector('#active-filters').textContent=active?' ('+active+')':'';
  main.querySelectorAll('[data-column]').forEach(th=>{const selected=th.dataset.column===clientState.sort;th.setAttribute('aria-sort',selected?(clientState.direction==='asc'?'ascending':'descending'):'none');th.querySelector('span').textContent=selected?(clientState.direction==='asc'?' ↑':' ↓'):' ↕';});
  main.querySelector('#results').innerHTML=result.items.map(c=>'<tr class="client-row"><td>'+escapeHtml(c.client_no)+'</td><td><a href="#profile/'+encodeURIComponent(c.id)+'"><strong>'+escapeHtml(c.legal_name)+'</strong></a></td><td>'+escapeHtml(D.types[c.type])+'</td><td>'+escapeHtml(c.location||'Не вказано')+'</td><td>'+escapeHtml(c.sectors?.join(', ')||'Не вказано')+'</td><td>'+escapeHtml(D.statuses[c.status])+'</td><td class="numeric">'+c.application_count+'</td></tr>').join('')||'<tr><td colspan="7" class="empty">Клієнтів не знайдено. Змініть запит або скиньте фільтри.</td></tr>';
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
function showProfile(id,initialTab='Огляд') {
 const c=crm.data().clients.find(c=>c.id===id);
 if(id&&!c){main.innerHTML=heading('Клієнта не знайдено','Клієнта видалено або посилання застаріле.','<a href="#clients">До клієнтів</a>');return;}
 main.innerHTML=heading(c?escapeHtml(c.legal_name):'Новий клієнт',c?'№ '+escapeHtml(c.client_no):'Основні дані; розширені відомості можна додати у вкладці «Досьє».','<a href="#clients">До клієнтів</a>')+(c?'<div class="actions"><button id="archive">'+(c.status==='archived'?'Відновити з архіву':'Архівувати')+'</button><button id="delete-client">Видалити клієнта</button><a class="button" href="#application/new/'+encodeURIComponent(c.id)+'">+ Заявка клієнта</a></div><div class="tabs" aria-label="Картка клієнта">'+['Огляд','Досьє','Контакти','Історія','Заявки'].map(t=>'<button data-tab="'+t+'">'+t+'</button>').join('')+'</div>':'')+'<section class="panel" id="profile-content"></section>';
 const show=(tab,editing=false)=>{
  main.querySelectorAll('[data-tab]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.tab===tab)));
  const content=main.querySelector('#profile-content');
  if(tab==='Огляд'||tab==='Досьє'){
   const fields=tab==='Огляд'?overviewFields:dossierFields;
   if(c&&!editing){
    content.innerHTML='<div class="actions"><h2>'+tab+'</h2><button id="edit-client" class="button secondary">Редагувати</button></div><dl class="profile-details">'+fields.map(([k,l])=>'<div><dt>'+l+'</dt><dd>'+escapeHtml(clientFieldValue(c,k)||'Не вказано')+'</dd></div>').join('')+'</dl>';
    content.querySelector('#edit-client').onclick=()=>show(tab,true);return;
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
   content.innerHTML='<h2>Заявки</h2>'+(crm.data().applications.filter(a=>a.client_id===id).map(a=>'<div class="row"><a href="#application/'+encodeURIComponent(a.id)+'">'+escapeHtml(a.title)+'</a><span>'+escapeHtml(CrmCore.statuses[a.status])+(a.archived_at?' · Архів':'')+'</span></div>').join('')||'<p>Заявок ще немає.</p>');
  }else{
   const contacts=tab==='Контакти',table=contacts?'contacts':'interactions';
   const fields=contacts?[['full_name','Ім’я *'],['role','Роль'],['email','Електронна адреса'],['phone','Телефон'],['preferred_channel','Бажаний канал']]:[['happened_at','Дата і час із поясом *'],['summary','Підсумок *'],['next_step','Наступний крок']];
   content.innerHTML='<h2>'+tab+'</h2>'+(crm.data()[table].filter(r=>r.client_id===id).map(r=>'<article class="row"><div>'+(contacts?'<strong>'+escapeHtml(r.full_name)+'</strong><p>'+escapeHtml([r.role,r.email,r.phone,r.preferred_channel].filter(Boolean).join(' · '))+'</p>':'<strong>'+escapeHtml(r.type)+' · '+escapeHtml(r.happened_at)+'</strong><p>'+escapeHtml(r.summary)+'</p><p>'+escapeHtml(r.next_step)+'</p>')+'</div></article>').join('')||'<p>Записів ще немає.</p>');
   if(!editing){content.innerHTML+='<button id="add-related" class="button secondary">'+(contacts?'Додати контакт':'Додати взаємодію')+'</button>';content.querySelector('#add-related').onclick=()=>show(tab,true);return;}
   content.innerHTML+='<form><div class="form-grid">'+(contacts?'':selectField('type','Вид взаємодії',{'Дзвінок':'Дзвінок','Зустріч':'Зустріч','Лист':'Лист','Повідомлення':'Повідомлення','Рекомендація':'Рекомендація','Передача документів':'Передача документів'},'Дзвінок'))+fields.map(([k,l])=>field(k,l,k==='happened_at'?new Date().toISOString():'')).join('')+'</div><div class="actions"><button class="button">Додати запис</button><button id="cancel-related" type="button">Скасувати</button></div><p id="form-result" class="error" role="alert"></p></form>';
   content.querySelector('#cancel-related').onclick=()=>show(tab);
   bindForm(async input=>{await crm.addRelated(table,{...input,client_id:id});refreshData();show(tab);});
  }
 };
 main.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>show(b.dataset.tab));
 if(c){main.querySelector('#archive').onclick=async()=>{try{await localWrite(()=>crm.clientAction(id,c.status==='archived'?'restore':'archive'));refreshData();showProfile(id);}catch(e){alert(e.message);}};main.querySelector('#delete-client').onclick=async()=>{if(await confirmAction('Видалити клієнта? Його заявки також буде приховано з реєстру. Дані та зв’язки залишаться у сховищі.'))try{await localWrite(()=>crm.clientAction(id,'delete',true));refreshData();location.hash='clients';}catch(e){alert(e.message);}};}
 show(initialTab);
}
function application(id,clientId) {
 const a=crm.data().applications.find(a=>a.id===id);if(id&&id!=='new'&&!a){main.innerHTML=heading('Заявку не знайдено','Оберіть заявку в реєстрі.');return;}
 main.innerHTML=heading(a?'Редагування заявки':'Нова заявка','Дати: ISO 8601 із часовим поясом; порожня сума означає невідому.')+`<section class="panel"><form><div class="form-grid">${selectField('client_id','Клієнт *',Object.fromEntries(data.clients.map(c=>[c.id,c.legal_name])),a?.client_id||clientId)}${selectField('status','Статус',CrmCore.statuses,a?.status||'preparation')}${field('title','Назва заявки *',a?.title)}${field('grant','Грант *',a?.grant)}${field('donor','Донор *',a?.donor)}${field('deadline','Дедлайн (ISO із поясом)',a?.deadline)}${field('amount','Запитувана сума',a?.amount)}${field('award_amount','Присуджена сума',a?.award_amount)}${selectField('currency','Валюта',{EUR:'EUR',UAH:'UAH',USD:'USD',GBP:'GBP'},a?.currency||'EUR')}${field('submission_at','Дата подання (ISO із поясом)',a?.submission_at)}${field('donor_reply_at','Дата відповіді (ISO із поясом)',a?.donor_reply_at)}${field('notes','Примітки / результат',a?.notes,'textarea')}</div><button class="button">Зберегти заявку</button><a href="#home">До реєстру</a><p id="form-result" class="error" role="alert"></p></form>${a?`<button id="archive-application">${a.archived_at?'Відновити з архіву':'Архівувати'}</button>`+'<button id="delete-application">Видалити заявку</button>':''}</section>`;
 bindForm(async input=>{for(const k of ['amount','award_amount'])input[k]=input[k].trim()===''?null:Number(input[k]);await crm.saveApplication(input,a?.id,a?.version);refreshData();location.hash='home';});
 if(a)main.querySelector('#archive-application').onclick=async()=>{try{await localWrite(()=>crm.applicationAction(a.id,a.archived_at?'restore':'archive'));refreshData();application(a.id);}catch(e){main.querySelector('#form-result').textContent=e.message;}};
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
