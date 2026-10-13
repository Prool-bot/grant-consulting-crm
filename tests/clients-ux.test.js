const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const D=require('../source/shared/domain'),Core=require('../source/server/core');
const now=Date.parse('2026-10-13T12:00:00Z');
const base={client_id:'demo',currency:'EUR',amount:10,award_amount:2,status:'preparation',created_at:'2026-10-01T00:00:00Z',deadline:'2026-10-15T00:00:00Z'};
test('Агрегати: валюти, нуль, невідомі, архів, видалені та присуджені окремо',()=>{
 const rows=[base,{...base,currency:'UAH',amount:100,award_amount:0,archived_at:'demo'},{...base,amount:null,award_amount:null},{...base,amount:999,deleted_at:'demo'}];
 const before=JSON.stringify(rows),s=D.applicationSummaries(rows,now).get('demo');
 assert.deepEqual(s.requested,{EUR:10,UAH:100});assert.deepEqual(s.awarded,{EUR:2,UAH:0});assert.equal(s.application_count,3);assert.equal(s.requested_unknown,1);assert.equal(s.awarded_unknown,1);assert.equal(JSON.stringify(rows),before);
});
test('Дедлайн лише майбутній активний валідний; остання заявка за створенням',()=>{
 const rows=[base,...['rejected','stopped','won'].map(status=>({...base,status,deadline:'2026-10-14T00:00:00Z'})),{...base,archived_at:'demo',deadline:'2026-10-14T00:00:00Z'},{...base,deadline:'2026-10-12T00:00:00Z'},{...base,deadline:'2026-02-30T00:00:00Z'},{...base,deadline:'bad',created_at:'2026-10-12T00:00:00Z',submission_at:'2026-12-01T00:00:00Z'}];
 const s=D.applicationSummaries(rows,now).get('demo');assert.equal(s.next_deadline,base.deadline);assert.equal(s.last_application,'2026-10-12T00:00:00Z');assert.equal(D.applicationSummaries([{...base,deadline:'2026-10-12T00:00:00Z'}],now).get('demo').next_deadline,null);
});
test('Сортування агрегатів: числові значення, набори валют, невідомі завжди в кінці',()=>{
 for(const key of ['requested','awarded']){
  const rows=[{id:'b',[key]:{EUR:10}},{id:'a',[key]:{EUR:2}},{id:'multi',[key]:{EUR:1,UAH:2}},{id:'uah',[key]:{UAH:0}},{id:'missing'}];
  assert.deepEqual(rows.slice().sort((a,b)=>D.compareSummary(a,b,key,'asc')).map(r=>r.id),['a','b','multi','uah','missing']);
  assert.deepEqual(rows.slice().sort((a,b)=>D.compareSummary(a,b,key,'desc')).map(r=>r.id),['b','a','multi','uah','missing']);
 }
 for(const key of ['next_deadline','last_application'])for(const direction of ['asc','desc'])assert.equal([{[key]:null},{[key]:base.deadline}].sort((a,b)=>D.compareSummary(a,b,key,direction)).at(-1)[key],null);
});
function ui(){const context=vm.createContext({D,Intl,Date,window:{addEventListener(){}},document:{addEventListener(){}},escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});vm.runInContext(fs.readFileSync('source/web/m2.js','utf8'),context);return context;}
test('Форматування підсумків: невідоме не нуль, часткові суми позначені',()=>{
 const u=ui();assert.equal(u.summaryMoney({},'requested'),'Не вказано');assert.match(u.summaryMoney({requested:{EUR:0,UAH:12},requested_unknown:1},'requested'),/0 EUR · 12 UAH · Частина сум невідома/);
});
test('Історія: стабільний порядок, Kyiv узимку й улітку, ISO джерела незмінне',()=>{
 const u=ui();assert.match(u.kyivDateTime('2026-01-01T22:30:00Z'),/02.01.2026.*00:30/);assert.match(u.kyivDateTime('2026-07-01T21:30:00Z'),/02.07.2026.*00:30/);
 const rows=[{id:1,happened_at:'2026-01-01T00:00:00Z',summary:'<script>'},{id:2,happened_at:'2026-07-01T00:00:00Z'},{id:3,happened_at:'2026-07-01T00:00:00Z'}];const before=JSON.stringify(rows);
 assert.equal(JSON.stringify(u.sortedHistory(rows).map(r=>r.id)),'[2,3,1]');const html=u.historyView(rows);assert.doesNotMatch(html,/2026-01-01T|<script>/);assert.match(html,/&lt;script>/);assert.equal(JSON.stringify(rows),before);
});
test('Досьє: групи, старі реквізити, приховані порожні та індивідуальні поля',()=>{
 const u=ui(),c={type:'ngo',short_name:'Демо',website:'https://example.test',geography:'Демо регіон',competencies:'Демо навичка',next_action_at:base.deadline};
 const html=u.dossierView(c);assert.match(html,/Демо регіон/);assert.match(html,/https:\/\/example.test/);assert.doesNotMatch(html,/Демо навичка|Наступна дія|ЄДРПОУ/);assert.match(html,/data-edit-dossier/);assert.match(u.dossierView({...c,type:'individual'}),/Демо навичка/);assert.equal(c.competencies,'Демо навичка');
});
test('Контакти: екранування та безпечні посилання',()=>{
 const u=ui();assert.match(u.contactLink('demo@example.test','email'),/mailto:/);assert.match(u.contactLink('+380 (00) 123-45-67','phone'),/tel:\+380001234567/);
 for(const value of ['javascript:alert(1)','a@example.test?subject=x','<script>','a@example.test\r\nBcc:x'])assert.doesNotMatch(u.contactLink(value,'email'),/<a /);
 assert.match(u.contactsView([{id:'demo',full_name:'<script>'}]),/&lt;script>/);
});
test('Огляд: кількість, наступна дія та остання взаємодія ізольовані за клієнтом',()=>{
 const u=ui();u.state={applications:[base],interactions:[{client_id:'other',happened_at:'2026-12-01T00:00:00Z'},{client_id:'demo',happened_at:'2026-01-01T00:00:00Z'}]};vm.runInContext('crm={data:()=>state}',u);
 const html=u.profileSummary({id:'demo',status:'active',next_action_at:'2026-01-02T00:00:00Z'});assert.match(html,/Заявок<\/dt><dd>1/);assert.match(html,/01.01.2026/);assert.match(html,/02.01.2026/);assert.doesNotMatch(html,/01.12.2026/);
});
test('Контакт: UUID і поля збережено, конфлікт та чужий клієнт відхилені',()=>{
 const repo=new Core.LocalRepository(),s=new Core.CrmService(repo);const c=s.saveClient({legal_name:'Демо',type:'ngo',status:'active'}),r=s.addRelated('contacts',{client_id:c.id,full_name:'Демо контакт',phone:'1234567'});
 const changed=s.saveContact({...r,full_name:'Демо оновлено'},r.id,1);assert.equal(changed.id,r.id);assert.equal(changed.phone,'1234567');assert.equal(repo.read().contacts.length,1);assert.throws(()=>s.saveContact(r,r.id,1),/змінено/);assert.throws(()=>s.saveContact({...r,client_id:'other'},r.id,2),/змінено/);
});

test('Зміна типу зберігає приховані компетенції та портфоліо; журнал зберігає точний ISO',()=>{
 const repo=new Core.LocalRepository(),s=new Core.CrmService(repo);let c=s.saveClient({legal_name:'Демо',type:'individual',status:'active',competencies:'Демо навички',portfolio:'Демо портфоліо'});
 c=s.saveClient({legal_name:c.legal_name,type:'ngo',status:'active'},c.id,c.version);assert.equal(c.competencies,'Демо навички');assert.equal(c.portfolio,'Демо портфоліо');
 const iso='2026-10-13T10:15:22.072+03:00';s.addRelated('interactions',{client_id:c.id,summary:'Демо журнал',happened_at:iso});assert.equal(repo.read().interactions[0].happened_at,iso);
});
