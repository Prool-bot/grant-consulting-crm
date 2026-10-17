const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const R=require('../source/shared/registry');

function setup(rows=[]){
 const elements=new Map();
 const content={innerHTML:'',querySelector:key=>{if(!elements.has(key))elements.set(key,{innerHTML:''});return elements.get(key);},querySelectorAll:()=>[]};
 const data={clients:[{id:'demo-client',legal_name:'Демо: Клієнт'}],applications:rows};
 const context=vm.createContext({D:require('../source/shared/domain'),Intl,Date,CrmRegistry:R,CrmCore:{statuses:R.statuses},data,main:content,window:{addEventListener(){}},document:{addEventListener(){}},heading:t=>'<h1>'+t+'</h1>',escapeHtml:v=>String(v??'').replaceAll('<','&lt;').replaceAll('>','&gt;')});
 vm.runInContext(fs.readFileSync('source/web/m2.js','utf8'),context);
 context.service={data:()=>data};vm.runInContext('crm=service',context);
 return {context,content};
}

test('Вкладка заявок: сім колонок, лічильники, архів, ізоляція клієнта та екранування',()=>{
 const rows=[{id:'demo-a',client_id:'demo-client',application_no:'ДЕМО-2',title:'<script>Демо</script>',status:'submitted',amount:0,currency:'UAH',archived_at:'2026-10-13T00:00:00Z'}, {id:'demo-b',client_id:'other',status:'submitted'}, {id:'demo-c',client_id:'demo-client',deleted_at:'2026-10-13T00:00:00Z',status:'submitted'}];
 const before=JSON.stringify(rows),{context,content}=setup(rows);
 context.showClientApplications(content,'demo-client');
 assert.equal((content.innerHTML.match(/scope="col"/g)||[]).length,7);
 assert.match(content.innerHTML,/Усього: 1/);assert.match(content.innerHTML,/Подано · рішення очікується: <strong>1/);
 assert.match(content.innerHTML,/#application\/new\/demo-client/);
 const html=content.querySelector('tbody').innerHTML;
 assert.match(html,/application-row submitted/);assert.match(html,/Архів/);assert.match(html,/0 UAH/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/demo-b|demo-c/);
 assert.equal(JSON.stringify(rows),before);
});

test('Порожня вкладка, київські зимові й літні дати, невідома сума та валюта',()=>{
 const {context,content}=setup();context.showClientApplications(content,'demo-client');
 assert.match(content.querySelector('tbody').innerHTML,/Заявок ще немає/);
 assert.equal(context.applicationDate('2026-01-01T22:30:00Z'),'02.01.2026');
 assert.equal(context.applicationDate('2026-07-01T21:30:00Z'),'02.07.2026');
 assert.equal(context.applicationDate(''),'Не вказано');
 assert.equal(context.applicationAmount(null,'USD'),'Не вказано USD');
 assert.match(context.applicationAmount(1234.56,'GBP'),/1\s234,56 GBP/);
});

test('Відкриття заявки показує деталі без форми та запису, окрема кнопка редагування',()=>{
 const {context,content}=setup([{id:'demo-a',client_id:'demo-client',title:'Демо: Заявка',status:'preparation',amount:12,currency:'EUR',notes:'Демо: результат'}]);
 context.application('demo-a');
 assert.match(content.innerHTML,/Перегляд заявки/);assert.match(content.innerHTML,/Демо: результат/);
 assert.doesNotMatch(content.innerHTML,/<form|<input|<select/);
 assert.equal(typeof content.querySelector('#edit-application').onclick,'function');
 context.application('missing');assert.match(content.innerHTML,/Заявку не знайдено/);
});

test('Сім колонок сортуються в обох напрямках без зміни джерела',()=>{
 const rows=[{id:'a',application_no:'ДЕМО-2',title:'А',grant:'А',submission_at:'2026-10-13T10:00:00+03:00',deadline:'2026-10-14T10:00:00Z',amount:1,currency:'EUR',status:'rejected'}, {id:'b',application_no:'ДЕМО-10',title:'Б',grant:'Б',submission_at:'2026-10-13T08:00:00Z',deadline:'2026-10-15T10:00:00Z',amount:2,currency:'EUR',status:'submitted'}];
 const before=JSON.stringify(rows);
 for(const sort of ['application_no','title','grant','submission_at','deadline','amount','status']){
  assert.deepEqual(R.select(rows,[],{sort}).map(a=>a.id),['a','b']);
  assert.deepEqual(R.select(rows,[],{sort,direction:'desc'}).map(a=>a.id),['b','a']);
 }
 for(const sort of ['submission_at','deadline'])for(const direction of ['asc','desc'])assert.equal(R.select([...rows,{id:'empty',[sort]:''}],[],{sort,direction}).at(-1).id,'empty');
 assert.equal(JSON.stringify(rows),before);
});
