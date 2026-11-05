'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository}=require('../source/adapters/sheets');
const Core=require('../source/server/core');

const src=fs.readFileSync('source/server/Code.gs','utf8');
const smoke=src.slice(src.indexOf('function verifyCrmIsolatedSyntheticCrud()'),
 src.indexOf('function crmCalendarSync()'));
const scriptPin=smoke.match(/var expectedScriptHash='([0-9a-f]{64})'/)?.[1];
const sheetPin=smoke.match(/var expectedIdHash='([0-9a-f]{64})'/)?.[1];
if(!scriptPin||!sheetPin)throw Error('Missing staging or test sheet pin');
const hash=str=>createHash('sha256').update(str).digest('hex');
function fixture({scriptOk=true,sheetOk=true,denyOwner=false,failCreate=false}={}){
 let scratch=null,created=0,flushed=0,opened=0,authorized=0,calendarCalls=0;
 const logs=[];
 const ctx=vm.createContext({
  console:{log:msg=>logs.push(String(msg))},
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>key==='CRM_SPREADSHEET_ID'?'synthetic-configured-test-db-id':undefined
  })},
  ScriptApp:{getScriptId:()=> 'synthetic-staging-script-id'},
  CrmGateway:{authorize:()=>{
   authorized++;
   if(denyOwner)throw Error('private account detail');
  }},
  Session:{},
  SpreadsheetApp:{
   create:name=>{
    if(failCreate)throw Error('private quota details');
    assert.match(name,/^CRM_1_4_SYNTHETIC_CRUD_[0-9a-f-]{8}$/i);
    created++;scratch=new FakeSheets();return scratch;
   },
   openById:()=>{opened++;throw Error('Unexpected access to existing test database');},
   flush:()=>{flushed++;if(!scratch)throw Error('No scratch');return scratch.flush();}
  },
  LockService:{getScriptLock:()=>{if(!scratch)throw Error('No scratch');return scratch.lock();}},
  CalendarApp:{getDefaultCalendar:()=>{calendarCalls++;throw Error('Calendar forbidden');}},
  CrmSheets:{SheetsRepository},
  CrmCore:Core,
  Utilities:{getUuid:()=>randomUUID()},
 });
 vm.runInContext(src,ctx);
 ctx.crmHash_=str=>str==='synthetic-staging-script-id'
   ?scriptOk?scriptPin:'wrong-script-id'
   :str==='synthetic-configured-test-db-id'
    ?sheetOk?sheetPin:'wrong-test-sheet'
    :hash(str);
 return {
  run:()=>vm.runInContext('verifyCrmIsolatedSyntheticCrud()',ctx),
  get:()=>({scratch,created,flushed,opened,authorized,calendarCalls,logs})
 };
}
test('safe synthetic real-adapter CRUD on brand-new isolated FakeSheets, no Calendar calls',()=>{
 const f=fixture();f.run();
 const {scratch,created,opened,calendarCalls,logs,flushed}=f.get();
 assert.deepEqual(logs,[
  'CRM_SYNTHETIC_CRUD_OK; scratchCreated=1; schema=12; clients=1; contacts=1; applications=1; interactions=1; calendarEvents=0; originalTestSheetWrites=0'
 ]);
 assert.equal(created,1);assert.equal(opened,0);assert.equal(calendarCalls,0);
 assert.ok(flushed>0);
 const repo=new SheetsRepository({spreadsheet:scratch,lock:scratch.lock(),flush:()=>scratch.flush(),hash});
 const state=repo.read();
 assert.equal(state.modelVersion,12);
 assert.equal(state.clients.length,1);
 assert.equal(state.applications.length,1);
 assert.equal(state.contacts.length,1);
 assert.equal(state.interactions.length,1);
 assert.ok(state.clients[0].deleted_at);
 assert.ok(state.applications[0].deleted_at);
 assert.equal(state.interactions[0].calendar_action.time_zone,'Europe/Istanbul');
 assert.equal(state.interactions[0].calendar_action.state,'cancelled');
 assert.equal(scratch.held,false);
});
test('synthetic smoke denies unknown Apps Script before accessing any spreadsheet',()=>{
 const f=fixture({scriptOk:false});f.run();
 const x=f.get();
 assert.deepEqual(x.logs,['CRM_SYNTHETIC_CRUD_FAILED; code=TEST_SCRIPT_MISMATCH']);
 assert.equal(x.created,0);assert.equal(x.authorized,0);
 assert.equal(x.opened,0);
});
test('synthetic smoke denies wrong Script Property spreadsheet before creating scratch',()=>{
 const f=fixture({sheetOk:false});f.run();
 const x=f.get();
 assert.deepEqual(x.logs,['CRM_SYNTHETIC_CRUD_FAILED; code=TEST_SHEET_MISMATCH']);
 assert.equal(x.created,0);assert.equal(x.opened,0);
});
test('synthetic smoke rejects unauthenticated account before file creation',()=>{
 const f=fixture({denyOwner:true});f.run();
 const x=f.get();
 assert.deepEqual(x.logs,['CRM_SYNTHETIC_CRUD_FAILED; code=UNAVAILABLE']);
 assert.equal(x.created,0);
 assert.equal(x.opened,0);
});
test('synthetic smoke hides Google API errors and does not touch existing test DB',()=>{
 const f=fixture({failCreate:true});f.run();
 const x=f.get();
 assert.deepEqual(x.logs,['CRM_SYNTHETIC_CRUD_FAILED; code=UNAVAILABLE']);
 assert.equal(x.created,0);assert.equal(x.opened,0);
 assert.equal(x.logs.join(' ').includes('private'),false);
});
test('synthetic smoke pinned IDs match separate read-only preflight and CI workflow',()=>{
 const workflow=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
 assert.equal(scriptPin,workflow.match(/const expectedStagingHash='([0-9a-f]{64})'/)?.[1]);
 const testPreflight=src.slice(src.indexOf('function verifyCrmTestSheetConnection()'),
  src.indexOf('function verifyCrmTestDatabaseIntegrity()'));
 assert.ok(testPreflight.includes(scriptPin));
 assert.ok(testPreflight.includes(sheetPin));
});
