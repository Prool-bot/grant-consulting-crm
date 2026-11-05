'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function fixture({calendarId=null,owner=true,authorized=true}={}){
 const calls={default:0,byId:0,sync:0,authorize:0,repositories:0};
 const selectedCalendar={isOwnedByMe:()=>owner};
 const props={getProperty:key=>key==='CRM_CALENDAR_ID'?calendarId:null};
 const root={
  Date,Number,Error,JSON,
  PropertiesService:{getScriptProperties:()=>props},
  CalendarApp:{
   getDefaultCalendar(){calls.default++;return selectedCalendar;},
   getCalendarById(id){calls.byId++;assert.equal(id,calendarId);return selectedCalendar;}
  },
  CrmGateway:{authorize(){calls.authorize++;if(!authorized)throw Error('Доступ закрито.');}},
  Session:{},
  CrmCalendar:{syncPending(repository,calendar,parseTime,now,limit){
   calls.sync++;
   assert.equal(calendar,selectedCalendar);
   assert.equal(repository,'synthetic-repository');
   assert.equal(typeof parseTime,'function');
   assert.equal(typeof now,'function');
   assert.equal(limit,5);
   return {synced:0,failed:0,pending:0};
  }},
  crmRepository_(){calls.repositories++;return 'synthetic-repository';}
 };
 const ctx=vm.createContext(root);
 vm.runInContext(fs.readFileSync('source/server/Code.gs','utf8'),ctx);
 return {calls,run:()=>vm.runInContext('crmCalendarSync()',ctx)};
}

test('Apps Script: наявний основний календар вибирається за замовчуванням без ID',()=>{
 const {calls,run}=fixture();
 const result=run();
 assert.equal(result.ok,true);
 assert.equal(result.value.synced,0);
 assert.equal(calls.default,1);
 assert.equal(calls.byId,0);
 assert.equal(calls.sync,1);
 assert.equal(calls.authorize,1);
 assert.equal(calls.repositories,1);
});
test('Apps Script: явно заданий ID не підміняє основним календарем',()=>{
 const {calls,run}=fixture({calendarId:'test-id-only'});
 assert.equal(run().ok,true);
 assert.equal(calls.default,0);
 assert.equal(calls.byId,1);
 assert.equal(calls.sync,1);
});
test('Apps Script: календар не у власності блокується до будь-якої синхронізації',()=>{
 const {calls,run}=fixture({owner:false});
 const result=run();
 assert.equal(result.ok,false);
 assert.equal(result.code,'CALENDAR_NOT_CONFIGURED');
 assert.equal(calls.sync,0);
 assert.equal(calls.repositories,0);
});
test('Apps Script: відсутня авторизація блокує навіть пошук календаря',()=>{
 const {calls,run}=fixture({authorized:false});
 const result=run();
 assert.equal(result.ok,false);
 assert.equal(calls.authorize,1);
 assert.equal(calls.default,0);
 assert.equal(calls.byId,0);
 assert.equal(calls.sync,0);
});
