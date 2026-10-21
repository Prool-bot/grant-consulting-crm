'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const {SheetsRepository}=require('../source/adapters/sheets'),{CrmService}=require('../source/server/core');
const {FakeSheets}=require('./helpers/fake-sheets');
function fixture(enabled=true,emit){
 const book=new FakeSheets(),reports=[];let ticks=0;
 const diagnostics={enabled,clock:()=>++ticks,emit:emit||((r)=>{assert.equal(book.held,false);reports.push(r);})};
 const repo=options=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash:s=>createHash('sha256').update(s).digest('hex'),diagnostics,...options});
 repo().setup();repo().migrate12(0,true);reports.length=0;
 return {book,reports,repo,ticks:()=>ticks};
}
const client={legal_name:'Демо: PRIVATE_MARKER',type:'ngo',status:'active',catalog_note:'PRIVATE_MARKER'};
test('Діагностика: етапи читання/запису, власний час та обмежена схема без даних',()=>{
 const f=fixture(),r=f.repo();new CrmService(r).saveClient(client);assert.equal(f.reports.length,1);
 const report=f.reports[0];assert.deepEqual(Object.keys(report),['kind','version','stages']);
 for(const key of ['lock_wait','control_read','journal_read','checksum','sheets_verify','journal_write','sheets_update','flush','state_validate','repository_total']){
  const value=report.stages[key];assert.ok(value);assert.deepEqual(Object.keys(value),['calls','durationMs','selfMs','failures']);assert.ok(value.durationMs>=value.selfMs);assert.equal(value.failures,0);
 }
 assert.equal(report.stages.flush.calls,4);assert.equal(report.stages.control_read.calls,2);assert.equal(report.stages.journal_read.calls,2);
 assert.equal(Object.values(report.stages).reduce((n,s)=>n+s.selfMs,0),report.stages.repository_total.durationMs);
 const encoded=JSON.stringify(report);assert.doesNotMatch(encoded,/PRIVATE_MARKER|legal_name|requestId|revision|sheetId/);
 f.reports.length=0;r.read();assert.equal(f.reports.length,1);assert.equal(f.reports[0].stages.flush,undefined);assert.equal(f.reports[0].stages.journal_write,undefined);
});
test('Діагностика вимкнена: немає таймерів/виводу або додаткових Sheets-операцій',()=>{
 const off=fixture(false),on=fixture();off.book.reads=0;on.book.reads=0;off.repo().read();on.repo().read();assert.equal(off.ticks(),0);assert.equal(off.reports.length,0);assert.equal(off.book.reads,on.book.reads);
});
test('Збій отримання lock: анонімний звіт, lock не звільняється без отримання',()=>{
 const f=fixture();let released=false;const r=f.repo({lock:{tryLock:()=>false,releaseLock:()=>released=true}});
 assert.throws(()=>r.read(),/База зайнята/);assert.equal(released,false);assert.equal(f.reports[0].stages.lock_wait.failures,1);assert.equal(f.reports[0].stages.control_read,undefined);
});
test('Помилки годинника й виводу не змінюють результат або помилку сховища',()=>{
 const f=fixture(true,()=>{throw Error('PRIVATE_MARKER');});const r=f.repo({diagnostics:{enabled:true,clock:()=>{throw Error('PRIVATE_MARKER');},emit:()=>{throw Error('PRIVATE_MARKER');}}});
 const c=new CrmService(r).saveClient(client);assert.equal(r.read().clients[0].id,c.id);assert.equal(f.book.held,false);
 const bad=f.repo({hash:()=>{throw Error('original-storage-error');}});assert.throws(()=>bad.read(),/original-storage-error/);assert.equal(f.book.held,false);
});
test('Діагностика після збоїв на кожній межі зберігає відновлення й квитанції',()=>{
 function scenario(at,after){const f=fixture(),request={id:'00000000-0000-4000-8000-000000000099',fingerprint:'synthetic'},r=f.repo({expectedRevision:1,request});f.book.arm(at,after);try{new CrmService(r).saveClient(client);}catch{}const count=f.book.calls;f.book.arm(0);new CrmService(f.repo({expectedRevision:1,request})).saveClient(client);const state=f.repo().read();assert.equal(state.clients.length,1);assert.equal(state.receipts.length,1);assert.equal(f.book.held,false);assert.doesNotMatch(JSON.stringify(f.reports),/PRIVATE_MARKER|synthetic|00000000/);return count;}
 const count=scenario(0,false);for(let i=1;i<=count;i++)for(const after of [false,true])scenario(i,after);
});
test('Script Properties: потрібні одночасно точні test і true; RPC не вмикає діагностику',()=>{
 const logs=[],context={console:{log:s=>logs.push(s)}};vm.createContext(context);vm.runInContext(fs.readFileSync('source/server/Code.gs','utf8'),context);
 for(const [environment,enabled] of [[undefined,undefined],['production','true'],['test','false'],['test',undefined],['TEST','true'],['test','TRUE']])assert.equal(context.crmDiagnostics_({getProperty:k=>k==='CRM_ENVIRONMENT'?environment:enabled}),null);
 const d=context.crmDiagnostics_({getProperty:k=>k==='CRM_ENVIRONMENT'?'test':'true'});assert.equal(d.enabled,true);d.emit({kind:'crm_repository_timing',version:1,stages:{}});assert.equal(logs.length,1);
});
