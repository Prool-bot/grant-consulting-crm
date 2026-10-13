'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository,normalize}=require('../source/adapters/sheets');
const {CrmService}=require('../source/server/core');
const Gateway=require('../source/server/gateway');
const hash=s=>createHash('sha256').update(s).digest('hex');
const client={legal_name:'Демо: Синтетична організація',type:'ngo',status:'active',sectors:['Освіта'],capacity_note:'Вигадане досьє'};
const application={title:'Демо: Заявка',grant:'Демо: Конкурс',donor:'Демо: Донор',status:'preparation',amount:null,currency:'EUR'};
function fixture() {
  const book=new FakeSheets();
  const repo=options=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash,...options});
  repo().setup();return {book,repo,service:()=>new CrmService(repo(),randomUUID)};
}
test('Sheets: повторне налаштування не дублює аркуші та не скидає дані',()=>{
  const {book,repo,service}=fixture();const c=service().saveClient(client);
  const before=repo().snapshot();repo().setup();repo().setup();assert.equal(repo().snapshot(),before);assert.equal(book.sheets.size,8);
  assert.equal(repo().read().clients[0].id,c.id);
  book.getSheetByName('contacts').getRange(1,1).setValue('інша схема');assert.throws(()=>repo().setup(),/Несумісна/);
});
test('Sheets: CRUD М2, нормалізація профілю й гранту, сталі UUID та м’яке видалення',()=>{
  const {repo,service}=fixture(), s=service();const c=s.saveClient(client);
  const a=s.saveApplication({...application,client_id:c.id});
  s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Контакт',email:'demo@example.invalid'});
  s.addRelated('interactions',{client_id:c.id,summary:'Вигадана розмова',happened_at:'2026-10-12T12:00:00Z'});
  s.saveClient({...client,capacity_note:'Нове вигадане досьє'},c.id,c.version);
  s.saveApplication({...application,client_id:c.id,amount:123,status:'submitted'},a.id,a.version);
  const tables=normalize(repo().read());assert.equal(tables.client_profiles[0].client_id,c.id);
  assert.equal(tables.client_profiles[0].capacity_note,'Нове вигадане досьє');assert.equal(tables.clients[0].capacity_note,undefined);
  assert.equal(tables.applications[0].requested_amount,123);assert.equal(tables.applications[0].grant_id,tables.grants[0].id);
  assert.equal(tables.contacts[0].version,1);assert.equal(tables.interactions.length,1);
  s.clientAction(c.id,'archive');s.clientAction(c.id,'restore');assert.equal(s.data().clients[0].status,'active');
  s.deleteApplication(a.id,true);s.clientAction(c.id,'delete',true);assert.equal(s.data().clients.length,0);
  assert.equal(repo().read().interactions.length,1);assert.ok(repo().read().applications[0].deleted_at);
  assert.equal(s.saveClient(client).client_no,'0002');
});
test('Sheets: однакові назви грантів не об’єднуються',()=>{
  const {repo,service}=fixture(),s=service(),c=s.saveClient(client);
  s.saveApplication({...application,client_id:c.id});s.saveApplication({...application,client_id:c.id});
  const grants=normalize(repo().read()).grants;assert.equal(grants.length,2);assert.notEqual(grants[0].id,grants[1].id);
});
test('Sheets: валідація зв’язків, UUID, дублів та версій до запису',()=>{
  const {repo,service}=fixture(),s=service(),c=s.saveClient(client),before=repo().snapshot();
  assert.throws(()=>s.saveApplication({...application,client_id:randomUUID()}));
  assert.throws(()=>repo().transaction(state=>{state.clients.push({...state.clients[0]});}));
  assert.throws(()=>repo().transaction(state=>{state.clients[0].id='not-uuid';}));
  assert.throws(()=>repo().transaction(state=>{state.contacts.push({id:randomUUID(),version:1,client_id:randomUUID(),full_name:'Демо'});}));
  assert.throws(()=>s.saveClient({...client,legal_name:''},c.id,c.version));
  assert.equal(repo().snapshot(),before);
});
test('Sheets: два екземпляри відхиляють застарілу версію та ревізію, блокування звільняється',()=>{
  const {book,repo,service}=fixture(),s=service(),c=s.saveClient(client),revision=repo().read().revision;
  const first=repo({expectedRevision:revision}),second=repo({expectedRevision:revision});
  new CrmService(first,randomUUID).saveClient({...client,legal_name:'Демо: Зміна'},c.id,c.version);
  assert.throws(()=>new CrmService(second,randomUUID).clientAction(c.id,'delete',true),/Конфлікт/);
  assert.throws(()=>s.saveClient(client,c.id,c.version),/змінено/);
  book.held=true;assert.throws(()=>repo().read(),/зайнята/);book.held=false;
  assert.throws(()=>repo().transaction(()=>{throw Error('Валідація');}));assert.equal(book.held,false);
});
test('Sheets: повтор запиту повертає той самий результат, інше тіло з тим самим UUID відхилено',()=>{
  const {repo}=fixture(),request={id:randomUUID(),fingerprint:'synthetic-request'};
  const call=()=>new CrmService(repo({expectedRevision:0,request}),randomUUID).saveClient(client);
  const first=call();assert.deepEqual(call(),first);assert.equal(repo().read().clients.length,1);
  assert.throws(()=>new CrmService(repo({request:{...request,fingerprint:'other'}}),randomUUID).saveClient(client),/вже використано/);
});
test('Sheets: кожна межа запису й flush, збій ДО та ПІСЛЯ застосування, відновлення і повтор без дублів',()=>{
  function scenario(at,after) {
    const {book,repo,service}=fixture(),s=service(),c=s.saveClient(client);
    s.saveApplication({...application,client_id:c.id});s.addRelated('contacts',{client_id:c.id,full_name:'Демо'});
    const revision=repo().read().revision,request={id:randomUUID(),fingerprint:'synthetic-update'};
    book.arm(at,after);
    const call=()=>new CrmService(repo({expectedRevision:revision,request}),randomUUID).saveClient({...client,capacity_note:'Оновлено'},c.id,c.version);
    try{call();}catch(error){assert.match(error.message,/Імітація/);}
    const count=book.calls;book.arm(0);
    const result=call();assert.equal(result.version,2);
    const state=repo().read();assert.equal(state.clients.length,1);assert.equal(state.clients[0].capacity_note,'Оновлено');
    assert.equal(state.applications.length,1);assert.equal(state.contacts.length,1);assert.equal(state.revision,revision+1);
    assert.equal(book.held,false);return count;
  }
  const boundaries=scenario(0,false);
  for(let at=1;at<=boundaries;at++)for(const after of [false,true])scenario(at,after);
});
test('Sheets: перерване налаштування повторюється на кожній межі без дублів',()=>{
  const sample=new FakeSheets();const build=book=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash});
  build(sample).setup();
  for(let at=1;at<=sample.calls;at++)for(const after of [false,true]) {
    const book=new FakeSheets();book.arm(at,after);try{build(book).setup();}catch{}
    book.arm(0);build(book).setup();assert.equal(book.sheets.size,8);assert.equal(build(book).read().revision,0);
  }
});
test('Sheets: знімок/відновлення зберігають зв’язки, номери не повторюються, старі версії відхилено',()=>{
  const {repo,service}=fixture(),s=service(),c=s.saveClient(client);
  s.saveApplication({...application,client_id:c.id});const backup=repo().snapshot();s.saveClient(client);
  repo().restore(backup);assert.equal(repo().read().applications[0].client_id,c.id);
  assert.throws(()=>s.saveClient(client,c.id,c.version),/змінено/);assert.equal(s.saveClient(client).client_no,'0003');
  const invalid=JSON.parse(backup);invalid.applications[0].client_id=randomUUID();const before=repo().snapshot();
  assert.throws(()=>repo().restore(JSON.stringify(invalid)));assert.equal(repo().snapshot(),before);
});
test('Sheets: часткове відновлення зі знімка завершується, зайві рядки прибираються',()=>{
  const {book,repo,service}=fixture(),s=service();s.saveClient(client);const backup=repo().snapshot();s.saveClient(client);
  book.arm(6,true);assert.throws(()=>repo().restore(backup));book.arm(0);
  assert.equal(repo().read().clients.length,1);assert.equal(book.getSheetByName('clients').getLastRow(),2);
  assert.equal(s.saveClient(client).client_no,'0003');
});
test('Sheets: пошкоджений журнал та ручні зміни не скидають базу',()=>{
  const {book,repo,service}=fixture();service().saveClient(client);
  book.getSheetByName('clients').getRange(2,4).setValue('{"synthetic":"manual"}');
  assert.throws(()=>repo().read(),/поза CRM/);assert.equal(book.getSheetByName('clients').getRange(2,4).getValue(),'{"synthetic":"manual"}');
  assert.throws(()=>repo().repairProjection(1),/підтвердьте/);
  assert.throws(()=>repo().repairProjection(0,true),/Конфлікт/);
  repo().repairProjection(1,true);assert.equal(repo().read().clients[0].legal_name,client.legal_name);
  const control=JSON.parse(book.getSheetByName('_crm_control').getRange(2,1).getValue());
  book.getSheetByName('_crm_journal').getRange(control.committed.start,1).setValue('j:broken');
  assert.throws(()=>repo().read(),/Контрольна сума/);
});
test('Sheets: збій під час самого відновлення лишає pending для наступної спроби',()=>{
  const {book,repo,service}=fixture();book.arm(5);
  assert.throws(()=>service().saveClient(client));
  book.arm(2,true);assert.throws(()=>repo().read());
  book.arm(0);assert.equal(repo().read().clients.length,1);assert.equal(repo().read().revision,1);
});
test('Sheets: втрата керівної комірки не дозволяє повторному setup скинути журнал',()=>{
  const {book,repo,service}=fixture();const emptyBackup=repo().snapshot();service().saveClient(client);repo().restore(emptyBackup);
  book.getSheetByName('_crm_control').getRange(2,1).clearContent();
  const rows=book.getSheetByName('_crm_journal').getLastRow();
  assert.throws(()=>repo().setup(),/Втрачено метадані/);assert.equal(book.getSheetByName('_crm_journal').getLastRow(),rows);
});
test('Sheets: пошкоджений pending блокує записи без повернення до старого стану',()=>{
  const {book,repo,service}=fixture();book.arm(5);assert.throws(()=>service().saveClient(client));book.arm(0);
  const control=JSON.parse(book.getSheetByName('_crm_control').getRange(2,1).getValue());
  book.getSheetByName('_crm_journal').getRange(control.pending.start,1).setValue('j:corrupt');
  assert.throws(()=>repo().read(),/Контрольна сума/);assert.throws(()=>service().saveClient(client),/Контрольна сума/);
  assert.ok(JSON.parse(book.getSheetByName('_crm_control').getRange(2,1).getValue()).pending);
});
test('Sheets: розширення діапазонів і конкуренція під час транзакції',()=>{
  const {book,repo,service}=fixture();
  for(const sheet of book.sheets.values())sheet.maxRows=Math.max(2,sheet.getLastRow());
  service().saveClient(client);service().saveClient(client);assert.equal(repo().read().clients.length,2);
  repo().transaction(()=>{assert.throws(()=>repo().transaction(()=>{}),/зайнята/);});
  assert.equal(book.held,false);
});
test('Sheets: текст із формулами залишається JSON, завеликий запис відхилено до pending',()=>{
  const {repo,service}=fixture();service().saveClient({...client,description:'=IMPORTXML("https://example.invalid", "x")'+'😀'.repeat(16000)});
  assert.match(repo().read().clients[0].description,/^=IMPORTXML/);
  const before=repo().snapshot();assert.throws(()=>service().saveClient({...client,description:'x'.repeat(50000)}),/розмір/);assert.equal(repo().snapshot(),before);
});
test('Gateway: читання сторінками, приховані видалені зв’язки, білий список команд',()=>{
  const {repo,service}=fixture(),s=service();for(let i=0;i<22;i++)s.saveClient(client);
  const result=Gateway.query(repo(),{action:'listClients',args:{page:1}});assert.equal(result.result.items.length,2);assert.equal(result.revision,22);
  assert.throws(()=>Gateway.query(repo(),{action:'snapshot'}));
  assert.throws(()=>Gateway.mutate(repo(),randomUUID,{action:'restore',requestId:randomUUID(),revision:22}));
});
test('Gateway: відмова без налаштувань, порожня/чужа активна або ефективна ідентичність',()=>{
  const props={CRM_ENABLED:'true',CRM_OWNER_EMAIL:'owner@example.invalid'},properties={getProperty:k=>props[k]};
  const session=(active,effective)=>({getActiveUser:()=>({getEmail:()=>active}),getEffectiveUser:()=>({getEmail:()=>effective})});
  Gateway.authorize(properties,session(props.CRM_OWNER_EMAIL,props.CRM_OWNER_EMAIL));
  for(const [active,effective] of [['',props.CRM_OWNER_EMAIL],['other@example.invalid',props.CRM_OWNER_EMAIL],[props.CRM_OWNER_EMAIL,'other@example.invalid']])assert.throws(()=>Gateway.authorize(properties,session(active,effective)));
  props.CRM_ENABLED='false';assert.throws(()=>Gateway.authorize(properties,session(props.CRM_OWNER_EMAIL,props.CRM_OWNER_EMAIL)));
});

test('Sheets: редагування окремих вкладок не змінює схему чи наявні профілі',()=>{
 const {book,repo,service}=fixture(),s=service();const c=s.saveClient({...client,geography:'Демо: область',competencies:'Демо: навички'});
 const headers=[...book.sheets.values()].map(sheet=>sheet.rows[0].slice());
 const updated=s.saveClient({legal_name:'Демо: Перейменовано',type:c.type,status:c.status,location:'Демо: місто',sectors:['Культура']},c.id,c.version);
 assert.equal(updated.capacity_note,client.capacity_note);assert.equal(updated.geography,'Демо: область');
 s.saveClient({legal_name:updated.legal_name,type:updated.type,status:updated.status,capacity_note:'Демо: нова команда'},c.id,updated.version);
 const reopened=service().data().clients[0];assert.equal(reopened.location,'Демо: місто');assert.equal(reopened.competencies,'Демо: навички');assert.equal(reopened.capacity_note,'Демо: нова команда');
 assert.deepEqual([...book.sheets.values()].map(sheet=>sheet.rows[0].slice()),headers);
 assert.equal(normalize(repo().read()).client_profiles.length,1);
});
