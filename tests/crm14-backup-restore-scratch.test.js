'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createHash,randomUUID}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository}=require('../source/adapters/sheets');
const Core=require('../source/server/core');

const source=fs.readFileSync('source/server/Code.gs','utf8');
const block=source.slice(source.indexOf('function verifyCrmIsolatedBackupRestore()'),source.indexOf('function crmCalendarSync()'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const scriptPin=block.match(/var expectedScriptHash='([0-9a-f]{64})'/)?.[1];
const sheetPin=block.match(/var expectedIdHash='([0-9a-f]{64})'/)?.[1];
if(!scriptPin||!sheetPin)throw Error('Missing approved staging pins');
const claimKey='CRM14_BACKUP_RESTORE_SYNTHETIC_20261105';
function fixture({scriptOk=true,sheetOk=true,authorized=true,failAfter=0}={}){
 const logs=[],properties=new Map([['CRM_SPREADSHEET_ID','synthetic-configured-test-db-id']]);
 const books=[],calls={created:0,opened:0,calendar:0,authorize:0,lock:0};
 let held=false;
 const lock={
  tryLock:()=>{calls.lock++;if(held)return false;held=true;return true;},
  releaseLock:()=>{held=false;}
 };
 const context=vm.createContext({
  console:{log:value=>logs.push(String(value))},
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>properties.get(key),
   setProperty:(key,value)=>{properties.set(key,String(value));}
  })},
  ScriptApp:{getScriptId:()=> 'synthetic-staging-script-id'},
  Session:{},
  CrmGateway:{authorize:()=>{
   calls.authorize++;
   if(!authorized)throw Error('private owner details');
  }},
  LockService:{getScriptLock:()=>lock},
  SpreadsheetApp:{
   create:name=>{
    calls.created++;
    if(calls.created===failAfter)throw Error('private Google API quota detail');
    assert.match(name,/^CRM_1_4_(?:BACKUP_SYNTHETIC_SOURCE|RESTORE_SYNTHETIC_TARGET)_[0-9a-f-]{8}$/i);
    const book=new FakeSheets();book.getId=()=> 'synthetic-id-of-new-file-'+calls.created;
    books.push(book);return book;
   },
   openById:()=>{calls.opened++;throw Error('existing database must never be accessed');},
   flush:()=>{books.forEach(book=>book.flush());}
  },
  CalendarApp:{
   getDefaultCalendar:()=>{calls.calendar++;throw Error('Calendar forbidden');}
  },
  Utilities:{getUuid:()=>randomUUID()},
  CrmCore:Core,
  CrmSheets:{SheetsRepository},
 });
 vm.runInContext(source,context);
 context.crmHash_=value=>{
  if(value==='synthetic-staging-script-id')return scriptOk?scriptPin:'wrong-script';
  if(value==='synthetic-configured-test-db-id')return sheetOk?sheetPin:'wrong-sheet';
  return hash(value);
 };
 return {run:()=>{vm.runInContext('verifyCrmIsolatedBackupRestore()',context);assert.equal(held,false);},
  inspect:()=>({logs,properties,books,calls})};
}
test('Backup restore: two entirely fresh isolated Sheets verify real repository journal and linkage',()=>{
 const f=fixture();f.run();const {logs,calls,books,properties}=f.inspect();
 assert.deepEqual(logs,['CRM_BACKUP_RESTORE_OK; scratchFiles=2; model=12; clients=1; applications=1; sourceUnchanged=1; originalTestSheetWrites=0; productionWrites=0; calendarEvents=0']);
 assert.equal(books.length,2);assert.equal(calls.created,2);assert.equal(calls.opened,0);assert.equal(calls.calendar,0);
 assert.equal(properties.get(claimKey),'DONE');
 const repo=book=>new SheetsRepository({
  spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash
 });
 const src=repo(books[0]).read(),target=repo(books[1]).read();
 assert.equal(src.modelVersion,12);assert.equal(target.modelVersion,12);
 assert.equal(src.clients.length,1);assert.equal(target.clients.length,1);
 assert.equal(target.applications.length,1);
 assert.equal(target.clients[0].id,src.clients[0].id);
 assert.equal(target.applications[0].client_id,src.clients[0].id);
 assert.equal(target.applications[0].amount,123.45);
 assert.ok(target.clients[0].version>src.clients[0].version);
 assert.ok(books.every(b=>b.held===false));
});
test('Backup restore: rerun after success does not create additional files',()=>{
 const f=fixture();f.run();f.run();const {calls,books,logs}=f.inspect();
 assert.equal(calls.created,2);assert.equal(books.length,2);
 assert.equal(logs[1],'CRM_BACKUP_RESTORE_ALREADY_CLAIMED; newFiles=0');
});
test('Backup restore: rejects any unapproved staging script ID before Sheets access',()=>{
 const f=fixture({scriptOk:false});f.run();const x=f.inspect();
 assert.deepEqual(x.logs,['CRM_BACKUP_RESTORE_FAILED; code=TEST_SCRIPT_MISMATCH']);
 assert.equal(x.calls.created,0);assert.equal(x.calls.opened,0);
 assert.equal(x.calls.authorize,0);
 assert.equal(x.properties.has(claimKey),false);
});
test('Backup restore: rejects other bound database ID before Sheets access',()=>{
 const f=fixture({sheetOk:false});f.run();const x=f.inspect();
 assert.deepEqual(x.logs,['CRM_BACKUP_RESTORE_FAILED; code=TEST_SHEET_MISMATCH']);
 assert.equal(x.calls.created,0);assert.equal(x.calls.opened,0);
 assert.equal(x.properties.has(claimKey),false);
});
test('Backup restore: rejects unauthorized owner without creating a file or claim',()=>{
 const f=fixture({authorized:false});f.run();const x=f.inspect();
 assert.deepEqual(x.logs,['CRM_BACKUP_RESTORE_FAILED; code=CHECK_MANUALLY; noAutomaticRetry=1']);
 assert.equal(x.calls.created,0);assert.equal(x.calls.opened,0);
 assert.equal(x.properties.has(claimKey),false);
});
test('Backup restore: failure after first scratch remains claimed; no automatic retry or private data in logs',()=>{
 const f=fixture({failAfter:2});f.run();f.run();const x=f.inspect();
 assert.equal(x.calls.created,2);assert.equal(x.books.length,1);
 assert.equal(x.properties.get(claimKey),'CHECK_MANUALLY');
 assert.equal(x.logs[0],'CRM_BACKUP_RESTORE_FAILED; code=CHECK_MANUALLY; noAutomaticRetry=1');
 assert.equal(x.logs[1],'CRM_BACKUP_RESTORE_ALREADY_CLAIMED; newFiles=0');
 assert.doesNotMatch(x.logs.join('\n'),/synthetic-id-of-new-file|private Google API quota detail/);
 assert.equal(x.calls.opened,0);
 assert.equal(x.calls.calendar,0);
});
test('Backup restore: pinned Script ID and staging test Spreadsheet match safe preflight',()=>{
 const workflow=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
 const pinned=workflow.match(/const expectedStagingHash='([a-f0-9]{64})'/)?.[1];
 assert.equal(scriptPin,pinned);
 const preflight=source.slice(source.indexOf('function verifyCrmTestDatabaseIntegrity()'),source.indexOf('function verifyCrmIsolatedSyntheticCrud()'));
 assert.ok(preflight.includes(sheetPin));
 assert.ok(preflight.includes(scriptPin));
});
