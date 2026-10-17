'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository,normalize}=require('../source/adapters/sheets');
const {CrmService}=require('../source/server/core');
const D=require('../source/shared/domain');
const R=require('../source/shared/registry');
const Gateway=require('../source/server/gateway');
const {Service}=require('../source/web/remote');
const hash=s=>createHash('sha256').update(s).digest('hex');
const client={legal_name:'Демо: Організація',type:'ngo',status:'active',edrpou_optional:'00123456'};
const app={title:'Демо: Заявка',grant:'Демо: Конкурс',donor:'Демо: Донор',status:'preparation',currency:'EUR',amount:null,deadline:'2026-10-25T01:30:00Z'};
const partner={name:'Демо: Спільний партнер',type:'ngo',contacts:'demo@example.invalid'};
const document={title:'Демо: Документ',category:'memorandum',url:'https://drive.google.com/file/d/synthetic-not-a-real-file/view',document_date:'2026-10-17'};
function fixture(migrate=true) {
 const book=new FakeSheets();
 const repo=options=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash,...options});
 repo().setup();const service=new CrmService(repo(),randomUUID),c=service.saveClient(client),a=service.saveApplication({...app,client_id:c.id});
 const before=repo().read();if(migrate)repo().migrate12(before.revision,true);
 return {book,repo,service,c,a,before};
}
const link=(c,p)=>({client_id:c.id,partner_id:p.id,status:'active',role:'Демо: Співпраця',memorandum:false,support_letter:false});
test('CRM 1.2: календарні дати, справжні дні, DST, сьогодні/вчора/завтра й сортування',()=>{
 for(const date of ['2026-03-29','2026-10-25','2024-02-29'])assert.equal(D.validDate(date),true);
 for(const date of ['2026-02-30','2026-02-29','2026-13-01','2026-10-25T01:00:00',''])assert.equal(D.validDate(date),false);
 assert.equal(D.calendarDate('2026-03-28T22:30:00Z'),'2026-03-29');
 assert.equal(D.calendarDate('2026-10-24T21:30:00Z'),'2026-10-25');
 for(const now of ['2026-03-29T20:00:00Z','2026-10-25T20:00:00Z']) {
  const today=D.calendarDate(now),day=+today.slice(-2),prefix=today.slice(0,8);
  const rows=[day-1,day,day+1].map(n=>({...app,id:String(n),client_id:'demo',deadline:prefix+n}));
  assert.equal(D.applicationSummaries(rows,Date.parse(now)).get('demo').next_deadline,today);
  assert.equal(D.applicationSummaries(rows.filter(r=>r.deadline!==today),Date.parse(now)).get('demo').next_deadline,prefix+(day+1));
  assert.deepEqual(R.select(rows,[],{sort:'deadline'}).map(r=>r.deadline),rows.map(r=>r.deadline));
 }
});
test('CRM 1.2: ЄДРПОУ залишається текстом, шукається й сортується',()=>{
 const {service:s,c}=fixture();s.saveClient({...client,legal_name:'Демо: Другий',edrpou_optional:'00000002'});
 assert.equal(s.listClients({query:'00123456'}).items[0].id,c.id);
 assert.deepEqual(s.listClients({sort:'edrpou_optional'}).items.map(r=>r.edrpou_optional),['00000002','00123456']);
});
test('CRM 1.2: URL, дати й старий ISO проходять normalize / snapshot / restore',()=>{
 const {repo,service:s,c,a}=fixture();
 const saved=s.saveApplication({...app,client_id:c.id,official_url:'https://example.invalid/grant',submission_at:'2026-10-17'},a.id,a.version);
 assert.equal(saved.deadline,app.deadline);
 assert.equal(normalize(repo().read()).applications[0].official_url,saved.official_url);
 const backup=repo().snapshot();repo().restore(backup);
 assert.equal(repo().read().applications[0].submission_at,'2026-10-17');assert.equal(repo().read().applications[0].deadline,app.deadline);
 for(const url of ['javascript:alert(1)','data:text/html,x','http://example.invalid','https://user:pass@example.invalid','https://example.invalid\\@evil.invalid','https://example.invalid/\" onmouseover=\"x'])assert.throws(()=>s.saveApplication({...app,client_id:c.id,official_url:url}));
});
test('CRM 1.2: спільний партнер, документи, докази й ізольоване м’яке видалення',()=>{
 const {repo,service:s,c,a}=fixture(),c2=s.saveClient({...client,legal_name:'Демо: Інший клієнт'}),p=s.saveCatalog('partners',partner);
 const first=s.saveCatalog('client_partners',link(c,p)),second=s.saveCatalog('client_partners',link(c2,p));
 assert.throws(()=>s.saveCatalog('partners',{...partner,name:'  ДЕМО: СПІЛЬНИЙ ПАРТНЕР  '}),/вже є/);
 assert.throws(()=>s.saveCatalog('client_partners',link(c,p)),/уже приєднаний/);
 const doc=s.saveCatalog('documents',{...document,client_id:c.id,application_id:a.id,client_partner_id:first.id});
 const evidence=s.saveCatalog('client_partners',{...link(c,p),memorandum:true,memorandum_date:'2026-10-17',memorandum_document_id:doc.id},first.id,first.version);
 assert.throws(()=>s.saveCatalog('client_partners',{...link(c2,p),memorandum_document_id:doc.id},second.id,second.version),/документ/);
 assert.throws(()=>s.saveCatalog('documents',{...document,client_id:c2.id,application_id:a.id}),/належить/);
 assert.throws(()=>s.removeCatalog('documents',doc.id,doc.version,false),/Підтвердіть/);
 s.removeCatalog('client_partners',first.id,evidence.version,true);
 assert.equal(s.data().client_partners.length,1);assert.equal(s.data().client_partners[0].id,second.id);assert.equal(s.data().partners.length,1);assert.equal(s.data().documents.length,1);
 s.removeCatalog('documents',doc.id,doc.version,true);assert.equal(s.data().documents.length,0);assert.equal(repo().read().documents[0].url,doc.url);
 const backup=repo().snapshot();repo().restore(backup);assert.equal(repo().read().partners[0].id,p.id);assert.ok(repo().read().documents[0].deleted_at);
});
test('CRM 1.2: тільки дозволені Drive URL та реальні дати; неправильні зв’язки й версії не змінюють стан',()=>{
 const {repo,service:s,c}=fixture(),before=repo().snapshot();
 for(const url of ['https://example.invalid/file','https://drive.google.com.evil.invalid/file/d/fake','https://drive.google.com@evil.invalid/file/d/fake','https://drive.google.com/drive/folders/fake','javascript:alert(1)'])assert.throws(()=>s.saveCatalog('documents',{...document,client_id:c.id,url}));
 assert.throws(()=>s.saveCatalog('documents',{...document,client_id:c.id,document_date:'2026-02-30'}));assert.equal(repo().snapshot(),before);
 const doc=s.saveCatalog('documents',{...document,client_id:c.id});assert.throws(()=>s.saveCatalog('documents',{note:'Демо'},doc.id,9),/змінено/);
 assert.throws(()=>s.removeCatalog('documents',doc.id,9,true),/змінено/);
});
test('CRM 1.2: стара схема читається, новий UI просить міграцію, відмова без копії або зі старою ревізією',()=>{
 const {repo,before,book}=fixture(false);assert.deepEqual(repo().read(),before);
 assert.throws(()=>Gateway.query(repo(),{action:'listData',args:{table:'documents'}}),/MIGRATION_REQUIRED/);
 assert.throws(()=>repo().migrate12(before.revision,false),/копії/);assert.throws(()=>repo().migrate12(before.revision-1,true),/Конфлікт/);
 assert.equal(book.sheets.size,8);assert.deepEqual(repo().read(),before);
 const result=repo().migrate12(before.revision,true);assert.equal(result.revision,before.revision+1);
 assert.equal(book.sheets.size,11);assert.equal(repo().control().schema,2);assert.deepEqual(repo().migrate12(before.revision,true),result);
 for(const key of ['clients','applications','contacts','interactions','receipts','sequence'])assert.deepEqual(repo().read()[key],before[key]);
 assert.throws(()=>repo().restore(JSON.stringify(before)),/Старий знімок/);
});
test('CRM 1.2: міграція повторюється після збою ДО/ПІСЛЯ кожного запису й flush без втрат',()=>{
 function scenario(at,after) {
  const {repo,book,before}=fixture(false);book.arm(at,after);
  try{repo().migrate12(before.revision,true);}catch(e){assert.match(e.message,/Імітація/);}
  const count=book.calls;book.arm(0);repo().migrate12(before.revision,true);
  const state=repo().read();assert.equal(state.revision,before.revision+1);
  for(const key of ['clients','applications','contacts','interactions','receipts','sequence'])assert.deepEqual(state[key],before[key]);
  assert.equal(state.documents.length,0);assert.equal(book.sheets.size,11);assert.equal(book.held,false);return count;
 }
 const count=scenario(0,false);for(let i=1;i<=count;i++)for(const after of [false,true])scenario(i,after);
});
test('CRM 1.2: чужі аркуші та ручні зміни блокують міграцію без перезапису',()=>{
 const {repo,book,before}=fixture(false);book.insertSheet('documents').getRange(1,1).setValue('Сторонні дані');
 assert.throws(()=>repo().migrate12(before.revision,true),/Несумісна/);assert.equal(book.getSheetByName('documents').getRange(1,1).getValue(),'Сторонні дані');assert.deepEqual(repo().read(),before);
});
test('CRM 1.2: нова транзакція відновлюється на кожній межі, requestId не створює дубль',()=>{
 function scenario(at,after) {
  const {repo,book,c}=fixture(),revision=repo().read().revision,request={id:randomUUID(),fingerprint:'synthetic-document'};
  const call=()=>new CrmService(repo({expectedRevision:revision,request}),randomUUID).saveCatalog('documents',{...document,client_id:c.id});
  book.arm(at,after);try{call();}catch(e){assert.match(e.message,/Імітація/);}
  const count=book.calls;book.arm(0);const result=call();assert.equal(call().id,result.id);assert.equal(repo().read().documents.length,1);assert.equal(repo().read().revision,revision+1);return count;
 }
 const count=scenario(0,false);for(let i=1;i<=count;i++)for(const after of [false,true])scenario(i,after);
});
test('CRM 1.2: remote CRUD каталогів, повтор після втраченої відповіді, конфлікт та видалення',async()=>{
 const {repo,c}=fixture();let lose=false;
 const call=async(method,r)=>{const result=method==='crmQuery'?Gateway.query(repo(),r):Gateway.mutate(repo({expectedRevision:r.revision,request:{id:r.requestId,fingerprint:hash(JSON.stringify(r))}}),randomUUID,r);if(lose&&method==='crmMutate'){lose=false;throw Error('Обрив');}return result;};
 const s=new Service(call,randomUUID);await s.reload();lose=true;
 const input={...document,client_id:c.id};await assert.rejects(s.saveCatalog('documents',input),/Обрив/);const d=await s.saveCatalog('documents',input);
 assert.equal(s.data().documents.length,1);const updated=await s.saveCatalog('documents',{...input,title:'Демо: Оновлено'},d.id,d.version);
 await assert.rejects(s.saveCatalog('documents',input,d.id,d.version),/змінено/);
 await s.removeCatalog('documents',d.id,updated.version,true);assert.equal(s.data().documents.length,0);await s.saveClient({...client,legal_name:'Демо: Після вилучення'});assert.equal(s.data().clients.length,2);
});

test('CRM 1.2: повторна година при переході на зимовий час сортується за моментом ISO',()=>{
 const rows=[{id:'later',deadline:'2026-10-25T01:15:00Z'},{id:'earlier',deadline:'2026-10-25T00:45:00Z'},{id:'day',deadline:'2026-10-25'}];
 assert.deepEqual(R.select(rows,[],{sort:'deadline'}).map(r=>r.id),['day','earlier','later']);
});
test('CRM 1.2: restore нових колекцій після переривання зберігає докази, UUID і збільшує версії',()=>{
 function scenario(at,after) {
  const {repo,book,service:s,c}=fixture(),p=s.saveCatalog('partners',partner),l=s.saveCatalog('client_partners',link(c,p));
  const d=s.saveCatalog('documents',{...document,category:'support',client_id:c.id,client_partner_id:l.id});
  s.saveCatalog('client_partners',{...link(c,p),support_letter:true,support_document_id:d.id},l.id,l.version);
  const backup=repo().snapshot(),revision=repo().read().revision;
  book.arm(at,after);try{repo({expectedRevision:revision}).restore(backup);}catch(e){assert.match(e.message,/Імітація/);}
  const count=book.calls;book.arm(0);const current=repo().read();if(current.revision===revision)repo({expectedRevision:revision}).restore(backup);
  const result=repo().read();assert.equal(result.revision,revision+1);assert.equal(result.documents[0].id,d.id);assert.equal(result.documents[0].version,d.version+1);assert.equal(result.client_partners[0].support_document_id,d.id);
  assert.equal(result.partners[0].id,p.id);assert.equal(result.clients[0].id,c.id);return count;
 }
 const count=scenario(0,false);for(let i=1;i<=count;i++)for(const after of [false,true])scenario(i,after);
});

test('CRM 1.2: новий знімок не може обійти ручну міграцію старої бази',()=>{const old=fixture(false),next=fixture();const before=old.repo().snapshot();assert.throws(()=>old.repo().restore(next.repo().snapshot()),/MIGRATION_REQUIRED/);assert.equal(old.repo().snapshot(),before);assert.equal(old.repo().control().pending,null);});

test('CRM 1.2: приховані зв’язки після видалень не блокують подальші remote-записи',async()=>{
 const {repo,c,service:core}=fixture(),p=core.saveCatalog('partners',partner),l=core.saveCatalog('client_partners',link(c,p));
 const d=core.saveCatalog('documents',{...document,client_id:c.id,client_partner_id:l.id});
 core.saveCatalog('client_partners',{...link(c,p),memorandum:true,memorandum_document_id:d.id},l.id,l.version);
 const call=async(m,r)=>m==='crmQuery'?Gateway.query(repo(),r):Gateway.mutate(repo({expectedRevision:r.revision,request:{id:r.requestId,fingerprint:hash(JSON.stringify(r))}}),randomUUID,r);
 const s=new Service(call,randomUUID);await s.reload();await s.removeCatalog('documents',d.id,d.version,true);
 await s.saveClient({...client,legal_name:'Демо: Після видалення документа'});
 const active=s.data().client_partners[0];await s.removeCatalog('client_partners',active.id,active.version,true);
 await s.clientAction(c.id,'delete',true);await s.saveClient({...client,legal_name:'Демо: Після видалення клієнта'});
 assert.equal(s.data().documents.length,0);assert.equal(s.data().client_partners.length,0);assert.equal(s.data().partners.length,1);
});

test('CRM 1.2: невідома дата взаємодії залишається порожньою у Sheets',()=>{const {service:s,repo,c}=fixture();s.addRelated('interactions',{client_id:c.id,summary:'Демо: Дата невідома',happened_at:''});assert.equal(repo().read().interactions[0].happened_at,'');});
