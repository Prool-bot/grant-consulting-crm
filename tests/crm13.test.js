'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const D=require('../source/shared/domain'),Core=require('../source/server/core');
const {SheetsRepository,normalize}=require('../source/adapters/sheets');
const {FakeSheets}=require('./helpers/fake-sheets');
const base={legal_name:'ГО «Демо: довга українська назва організації»',type:'ngo',status:'active'};
const additions={nonprofit_code:'0032',registration_date:'2020-02-29',catalog_note:'Демо <script>текст</script>',social_links:[{platform:'facebook',url:'https://example.invalid/demo',label:''}]};
function ui(){const context=vm.createContext({D,Intl,Date,navigator:{locks:{request:(_,fn)=>fn()}},window:{addEventListener(){}},document:{addEventListener(){}},escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});vm.runInContext(fs.readFileSync('source/web/m2.js','utf8'),context);return context;}
test('CRM 1.3: усі типи, рядковий код із нулями, ліміти й необов’язковість',()=>{
 for(const type of Object.keys(D.types))assert.deepEqual(D.validateClient({...base,...additions,type}),{});
 assert.deepEqual(D.validateClient(base),{});
 for(const nonprofit_code of [32,'032','00322',' 0032','abcd'])assert.ok(D.validateClient({...base,nonprofit_code}).nonprofit_code);
 assert.ok(D.validateClient({...base,catalog_note:'x'.repeat(2001)}).catalog_note);
 for(const registration_date of ['2099-01-01','2023-02-29','2020-01-01T00:00:00Z'])assert.ok(D.validateClient({...base,registration_date}).registration_date);
});
test('CRM 1.3: соцмережі відхиляють HTML, credentials, небезпечні й мережеві URL',()=>{
 for(const url of ['javascript:alert(1)','//example.invalid','http://example.invalid','https://u:p@example.invalid','https://example.invalid/<img>','https://example.invalid/"','https://example.invalid\\evil'])assert.ok(D.validateClient({...base,social_links:[{platform:'other',url}]}).social_links);
 for(const social_links of [null,{},[null],[{platform:'bad',url:'https://example.invalid'}]])assert.ok(D.validateClient({...base,social_links}).social_links);
 const html=ui().dossierView({...base,...additions});assert.match(html,/target="_blank" rel="noopener noreferrer">Facebook/);assert.doesNotMatch(html,/<script>/);assert.match(html,/0032/);
});
test('CRM 1.3: повні роки, 29 лютого, сьогодні, Kyiv та фізособа',()=>{
 const age=(date,now,type='ngo')=>D.organizationAge({registration_date:date,type},now);
 assert.equal(age('2020-02-29','2023-02-28'),2);assert.equal(age('2020-02-29','2023-03-01'),3);assert.equal(age('2020-02-29','2024-02-29'),4);
 assert.equal(age('2026-01-01','2026-01-01'),0);assert.equal(age('2020-01-01','2025-12-31T22:30:00Z'),6);
 for(const date of ['',undefined,'2026-02-30','2099-01-01'])assert.equal(age(date,'2026-10-21'),null);
 assert.equal(age('2020-01-01','2026-10-21','individual'),null);
});
test('CRM 1.3: незалежні лічильники з архівом, видаленням і won без суми',()=>{
 const rows=[{status:'preparation',award_amount:100},{status:'submitted'},{status:'won',award_amount:null},{status:'rejected',archived_at:'demo'},{status:'stopped'},{status:'stopped',submission_at:'2026-10-01'},{status:'review',submission_at:'2026-10-01T20:00:00+03:00'},{status:'preparation',submission_at:'bad'},{status:'won',deleted_at:'demo'}].map(a=>({client_id:'demo',...a}));
 const s=D.applicationSummaries(rows).get('demo');assert.equal(s.application_count,8);assert.equal(s.submitted_count,5);assert.equal(s.won_count,1);
});
test('CRM 1.3: числові сортування, порожній вік в кінці, >20 записів і пошук типу',()=>{
 const repo=new Core.LocalRepository(),service=new Core.CrmService(repo);
 for(let i=0;i<25;i++){const c=service.saveClient({...base,legal_name:base.legal_name+i,type:i===24?'institute':'ngo',registration_date:i===24?'':'2000-01-01'});for(let j=0;j<i;j++)service.saveApplication({client_id:c.id,title:'Демо',grant:'Демо',donor:'Демо',currency:'EUR',status:'won'});}
 for(const sort of ['submitted_count','won_count']){assert.deepEqual(service.listClients({sort,limit:100}).items.map(c=>c[sort]),Array.from({length:25},(_,i)=>i));assert.equal(service.listClients({sort,direction:'desc'}).items[0][sort],24);}
 for(const direction of ['asc','desc'])assert.equal(service.listClients({sort:'organization_age',direction,limit:100}).items.at(-1).organization_age,null);
 assert.equal(service.listClients({page:1}).items.length,5);assert.equal(service.listClients({query:'Інститут'}).total,1);
});
test('CRM 1.3: JSON, старий backup, normalize/restore, профілі й заголовки без міграції',()=>{
 const book=new FakeSheets(),repo=new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash:s=>createHash('sha256').update(s).digest('hex')});repo.setup();repo.migrate12(repo.read().revision,true);
 const service=new Core.CrmService(repo),c=service.saveClient({...base,sectors:['Демо'],competencies:'Демо навички'}),old=repo.snapshot(),names=[...book.sheets.keys()];
 let saved=service.saveClient({...base,...additions},c.id,c.version);assert.equal(normalize(repo.read()).clients[0].nonprofit_code,'0032');assert.equal(normalize(repo.read()).client_profiles[0].competencies,'Демо навички');
 assert.deepEqual(service.listClients().items[0].social_links,additions.social_links);
 const backup=repo.snapshot();repo.restore(backup);assert.deepEqual(repo.read().clients[0],{...saved,version:saved.version+1});saved=repo.read().clients[0];assert.deepEqual([...book.sheets.keys()],names);assert.equal(repo.read().modelVersion,12);assert.equal(repo.control().schema,2);
 saved=service.saveClient({...base,catalog_note:'Оновлено'},saved.id,saved.version);assert.equal(saved.nonprofit_code,'0032');assert.deepEqual(saved.social_links,additions.social_links);assert.equal(saved.competencies,'Демо навички');
 assert.throws(()=>service.saveClient({...base,catalog_note:'Конфлікт'},c.id,c.version),/змінено/);repo.restore(old);assert.equal(repo.read().clients[0].nonprofit_code,undefined);assert.deepEqual(service.listClients().items[0].social_links,[]);
});
function cell(){const controls={};return {isConnected:true,html:'',set innerHTML(v){this.html=v;for(const k of ['button','textarea','[data-save]','[data-cancel]'])controls[k]={disabled:false};},get innerHTML(){return this.html;},querySelector(k){return controls[k];},querySelectorAll(){return Object.values(controls);}};}
test('CRM 1.3: редактор примітки зберігає текст при фільтрації/конфлікті, блокує подвійний клік',async()=>{
 const u=ui(),c={...base,id:'demo',version:7,catalog_note:''},a=cell();let calls=0,release;
 u.mock={saveClient:async(input,id,version)=>{calls++;assert.equal(version,7);assert.equal(input.catalog_note,'<b>Демо</b>');await new Promise(r=>release=r);throw Error('Конфлікт ревізії');}};vm.runInContext('crm=mock',u);
 u.renderCatalogNote(a,c);a.querySelector('button').onclick();a.querySelector('textarea').oninput({target:{value:'<b>Демо</b>'}});
 const b=cell();u.renderCatalogNote(b,c);assert.match(b.innerHTML,/&lt;b>Демо/);
 const save=b.querySelector('[data-save]').onclick,pending=save();await save();assert.equal(calls,1);release();await pending;assert.match(b.innerHTML,/Конфлікт ревізії/);assert.match(b.innerHTML,/&lt;b>Демо/);
 b.querySelector('[data-cancel]').onclick();assert.doesNotMatch(b.innerHTML,/textarea/);
});
test('CRM 1.3: компактні колонки, ширина назви, дворядковий clamp і локальна прокрутка',()=>{
 const js=fs.readFileSync('source/web/m2.js','utf8'),css=fs.readFileSync('source/web/styles.css','utf8');const columns=js.slice(js.indexOf('const columns='),js.indexOf(' main.innerHTML=',js.indexOf('const columns=')));
 for(const label of ['Подано','Отримано','Примітки','Код неприбутковості','Вік організації'])assert.ok(columns.includes(label));for(const label of ['Тип','Запитувано','Присуджено','Найближчий дедлайн'])assert.ok(!columns.includes(label));
 assert.match(css,/width:340px/);assert.match(css,/-webkit-line-clamp:2/);assert.match(css,/\.table-scroll\{[^}]*overflow:auto/);assert.match(js,/title=".*c.sectors/);
});
