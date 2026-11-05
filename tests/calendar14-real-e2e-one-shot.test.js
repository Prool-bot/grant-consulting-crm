'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository}=require('../source/adapters/sheets');
const Core=require('../source/server/core');
const Calendar=require('../source/server/calendar');

const src=fs.readFileSync('source/server/Code.gs','utf8');
const functionBody=src.slice(src.indexOf('function verifyCrmIsolatedCalendarSync()'),
 src.indexOf('function crmCalendarSync()'));
const scriptPin=functionBody.match(/var expectedScriptHash='([0-9a-f]{64})'/)?.[1];
const sheetPin=functionBody.match(/var expectedIdHash='([0-9a-f]{64})'/)?.[1];
if(!scriptPin||!sheetPin)throw Error('Missing protected staging pins');
const hash=x=>createHash('sha256').update(x).digest('hex');
class FakeEvent {
 constructor(calendar,title,start,end,options) {
  this.calendar=calendar;this.id='synthetic-event-'+(++calendar.eventSerial);
  this.title=title;this.start=start;this.end=end;this.description=options.description;
  this.reminders=[];this.visibility='DEFAULT';
 }
 getId(){
  if(this.calendar.loseReceipt){this.calendar.loseReceipt=false;throw Error('private calendar receipt error');}
  return this.id;
 }
 getDescription(){return this.description;}
 setDescription(value){this.description=value;}
 setTitle(value){this.title=value;}
 setTime(start,end){this.start=start;this.end=end;}
 setTag(){}
 setVisibility(value){this.visibility=value;}
 getVisibility(){return this.visibility;}
 removeAllReminders(){this.reminders=[];}
 addPopupReminder(minutes){this.reminders.push(minutes);}
 getPopupReminders(){return this.reminders;}
 getStartTime(){return this.start;}
 getEndTime(){return this.end;}
 deleteEvent(){this.calendar.events.delete(this.id);}
}
class FakeCalendar {
 constructor({owned=true,primary=true,loseReceipt=false}={}) {
  this.owned=owned;this.primary=primary;this.loseReceipt=loseReceipt;
  this.events=new Map();this.eventSerial=0;this.created=0;
 }
 isOwnedByMe(){return this.owned;}
 isMyPrimaryCalendar(){return this.primary;}
 createEvent(title,start,end,options){
  this.created++;
  const event=new FakeEvent(this,title,start,end,options);
  this.events.set(event.id,event);
  return event;
 }
 getEvents(start,end,options){
  return [...this.events.values()].filter(e=>e.start>=start&&e.start<=end&&
    e.description.includes(options.search));
 }
 getEventById(id){return this.events.get(id)||null;}
}
function fixture({scriptOk=true,sheetOk=true,denyOwner=false,owned=true,primary=true,
 loseReceipt=false,badClock=false}={}){
 const logs=[],stored=new Map([['CRM_SPREADSHEET_ID','approved-test-sheet-property']]);
 let scratch=null,creates=0,opened=0,calendarReads=0,authorized=0,lockHeld=false;
 const calendar=new FakeCalendar({owned,primary,loseReceipt});
 const scriptLock={
  tryLock:()=>{if(lockHeld)return false;lockHeld=true;return true;},
  releaseLock:()=>{lockHeld=false;}
 };
 const properties={
  getProperty:key=>stored.get(key),
  setProperty:(key,value)=>{stored.set(key,value);return properties;}
 };
 const context=vm.createContext({
  console:{log:x=>logs.push(String(x))},
  PropertiesService:{getScriptProperties:()=>properties},
  ScriptApp:{getScriptId:()=> 'approved-staging-script-property'},
  CrmGateway:{authorize:()=>{authorized++;if(denyOwner)throw Error('private owner error');}},
  Session:{},
  LockService:{getScriptLock:()=>scriptLock},
  SpreadsheetApp:{
   create:name=>{
    assert.match(name,/^CRM_1_4_E2E_CALENDAR_[a-f0-9-]{8}$/i);
    creates++;scratch=new FakeSheets();scratch.getId=()=> 'new-isolated-scratch-id';
    return scratch;
   },
   openById:()=>{opened++;throw Error('Existing CRM sheet must not be opened');},
   flush:()=>{if(!scratch)throw Error('No scratch');scratch.flush();}
  },
  CalendarApp:{
   Visibility:{PRIVATE:'PRIVATE'},
   getDefaultCalendar:()=>{calendarReads++;return calendar;}
  },
  Utilities:{getUuid:()=>randomUUID()},
  CrmSheets:{SheetsRepository},
  CrmCore:Core,
  CrmCalendar:Calendar,
  CrmDomain:require('../source/shared/domain'),
  Date,
 });
 vm.runInContext(src,context);
 context.crmHash_=value=>{
  if(value==='approved-staging-script-property')return scriptOk?scriptPin:'wrong-script-hash';
  if(value==='approved-test-sheet-property')return sheetOk?sheetPin:'wrong-sheet-hash';
  return hash(value);
 };
 context.crmCalendarLocalTime_=(day,time,zone)=>{
  assert.equal(zone,'Europe/Istanbul');
  assert.equal(day,'2026-11-06');assert.equal(time,'11:00');
  return new Date(badClock?'2026-11-06T09:00:00.000Z':'2026-11-06T08:00:00.000Z');
 };
 return {
  run:()=>{vm.runInContext('verifyCrmIsolatedCalendarSync()',context);assert.equal(lockHeld,false);},
  inspect:()=>({logs,stored,scratch,creates,opened,calendarReads,authorized,calendar})
 };
}
test('owner-approved real CRM sync: synthetic Sheets -> CRM Calendar one event in Istanbul with popup',()=>{
 const f=fixture();f.run();const x=f.inspect();
 assert.deepEqual(x.logs,[
  'CRM_E2E_CALENDAR_OK; date=2026-11-06; time=11:00-11:15; zone=Europe/Istanbul; reminder=5; synced=1; repeatSynced=0; originalTestSheetWrites=0'
 ]);
 assert.equal(x.creates,1);assert.equal(x.opened,0);assert.equal(x.calendar.created,1);
 assert.equal(x.calendar.events.size,1);
 const e=[...x.calendar.events.values()][0];
 assert.equal(e.start.toISOString(),'2026-11-06T08:00:00.000Z');
 assert.equal(e.end.toISOString(),'2026-11-06T08:15:00.000Z');
 assert.deepEqual(e.reminders,[5]);assert.equal(e.visibility,'PRIVATE');
 assert.match(e.title,/CRM 1.4 — тест нагадування/);
 assert.match(e.description,/CRM-ACTION:/);
 assert.equal(x.stored.get('CRM14_E2E_CALENDAR_20261106_1100_ISTANBUL'),'DONE');
 const repo=new SheetsRepository({
  spreadsheet:x.scratch,lock:x.scratch.lock(),flush:()=>x.scratch.flush(),hash
 });
 const state=repo.read();
 assert.equal(state.interactions.length,1);
 assert.equal(state.interactions[0].calendar_action.sync_status,'synced');
 assert.equal(state.interactions[0].calendar_action.event_id,e.id);
 assert.equal(state.clients.length,1);
 assert.equal(x.scratch.held,false);
});
test('owner-approved live smoke is one-shot even after repeated Run',()=>{
 const f=fixture();f.run();f.run();const x=f.inspect();
 assert.equal(x.calendar.created,1);
 assert.equal(x.creates,1);
 assert.equal(x.logs[1],'CRM_E2E_CALENDAR_ALREADY_CLAIMED; noNewEvents=1');
});
test('unauthorized Script or spreadsheet does not create files, events or claims',()=>{
 for(const opts of [{scriptOk:false},{sheetOk:false},{denyOwner:true}]){
  const f=fixture(opts);f.run();const x=f.inspect();
  assert.equal(x.creates,0);assert.equal(x.calendar.created,0);
  assert.equal(x.opened,0);
  assert.equal(x.stored.has('CRM14_E2E_CALENDAR_20261106_1100_ISTANBUL'),false);
  assert.match(x.logs[0],/^CRM_E2E_CALENDAR_FAILED;/);
 }
});
test('live smoke refuses an unowned or nonprimary calendar before claiming',()=>{
 for(const opts of [{owned:false},{primary:false}]){
  const f=fixture(opts);f.run();const x=f.inspect();
  assert.deepEqual(x.logs,['CRM_E2E_CALENDAR_FAILED; code=PRIMARY_CALENDAR_REQUIRED']);
  assert.equal(x.creates,0);assert.equal(x.calendar.created,0);
 }
});
test('live smoke refuses wrong Istanbul UTC offset before any write',()=>{
 const f=fixture({badClock:true});f.run();const x=f.inspect();
 assert.deepEqual(x.logs,['CRM_E2E_CALENDAR_FAILED; code=TIMEZONE_MISMATCH']);
 assert.equal(x.creates,0);assert.equal(x.calendar.created,0);
});
test('lost calendar receipt blocks later reruns instead of creating a duplicate event',()=>{
 const f=fixture({loseReceipt:true});f.run();
 let x=f.inspect();
 assert.equal(x.calendar.created,1);assert.equal(x.calendar.events.size,1);
 assert.equal(x.stored.get('CRM14_E2E_CALENDAR_20261106_1100_ISTANBUL'),'CHECK_MANUALLY');
 assert.deepEqual(x.logs,['CRM_E2E_CALENDAR_FAILED; code=CHECK_MANUALLY; noAutomaticRetry=1']);
 f.run();x=f.inspect();
 assert.equal(x.calendar.created,1);
 assert.equal(x.creates,1);
 assert.equal(x.logs[1],'CRM_E2E_CALENDAR_ALREADY_CLAIMED; noNewEvents=1');
});
test('one-shot smoke script and sheet pins match protected staging release',()=>{
 const workflow=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
 assert.equal(scriptPin,workflow.match(/const expectedStagingHash='([a-f0-9]{64})'/)?.[1]);
 const readOnly=src.slice(src.indexOf('function verifyCrmTestDatabaseIntegrity()'),src.indexOf('function verifyCrmIsolatedSyntheticCrud()'));
 assert.ok(readOnly.includes(scriptPin));
 assert.ok(readOnly.includes(sheetPin));
});
