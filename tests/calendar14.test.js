'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {CrmService,LocalRepository}=require('../source/server/core');
const {syncPending}=require('../source/server/calendar');
const stubClient={legal_name:'ГО «Тестовий клієнт»',type:'ngo',status:'active'};
const todo={title:'Подати уточнення',date:'2026-11-12',time:'10:30',duration_minutes:30,reminder_minutes:15};
const localTime=(date,time)=>new Date(date+'T'+time+':00+02:00');
class FakeEvent {
 constructor(title,start,end,options,calendar){
  this.id='test-event-'+(++calendar.serial);
  this.title=title;this.start=start;this.end=end;this.description=options?.description||'';
  this.calendar=calendar;this.tags={};this.reminders=[];this.deleted=false;
 }
 getId(){return this.id;}
 getDescription(){return this.description;}
 setDescription(v){this.description=v;}
 setTitle(v){this.title=v;}
 setTime(start,end){this.start=start;this.end=end;}
 setTag(k,v){this.tags[k]=v;}
 removeAllReminders(){this.reminders=[];}
 addPopupReminder(minutes){this.reminders.push(minutes);}
 deleteEvent(){this.deleted=true;this.calendar.events.delete(this.id);}
}
class FakeCalendar {
 constructor(){this.events=new Map();this.serial=0;this.created=0;}
 createEvent(title,start,end,options){
  this.created++;
  const e=new FakeEvent(title,start,end,options,this);this.events.set(e.id,e);return e;
 }
 getEventById(id){return this.events.get(id)||null;}
 getEvents(start,end,options){return [...this.events.values()].filter(e=>e.start>=start&&e.start<=end&&e.description.includes(options.search));}
}
function fixture(){
 const repo=new LocalRepository(),service=new CrmService(repo,randomUUID);
 const c=service.saveClient(stubClient);
 const interaction=service.addRelated('interactions',{client_id:c.id,type:'Дзвінок',summary:'Розмова',calendar_action:todo});
 return {repo,service,c,interaction,calendar:new FakeCalendar()};
}
test('Calendar CRM: створення, нагадування, статус і повтор без дубля',()=>{
 const {repo,calendar}=fixture();
 let result=syncPending(repo,calendar,localTime);
 assert.equal(result.synced,1);assert.equal(result.failed,0);assert.equal(result.pending,0);
 assert.equal(calendar.created,1);assert.equal(calendar.events.size,1);
 const e=[...calendar.events.values()][0];
 assert.deepEqual(e.reminders,[15]);assert.match(e.description,/CRM-ACTION:/);
 const row=repo.read().interactions[0];
 assert.equal(row.calendar_action.event_id,e.id);assert.equal(row.calendar_action.sync_status,'synced');
 result=syncPending(repo,calendar,localTime);
 assert.equal(result.synced,0);assert.equal(calendar.created,1);
});
test('Calendar CRM: відновлення після втраченої квитанції без створення дубля',()=>{
 const {repo,calendar}=fixture();
 syncPending(repo,calendar,localTime);
 repo.transaction(state=>{
  const a=state.interactions[0].calendar_action;
  a.event_id='';a.sync_status='error';a.error_code='SYNC_FAILED';
 });
 const result=syncPending(repo,calendar,localTime);
 assert.equal(result.synced,1);assert.equal(calendar.created,1);
 assert.equal(repo.read().interactions[0].calendar_action.sync_status,'synced');
});
test('Calendar CRM: скасування збереженої події і захист від повторів',()=>{
 const {repo,service,calendar,interaction}=fixture();
 syncPending(repo,calendar,localTime);
 const row=repo.read().interactions[0];
 service.updateCalendarAction(interaction.id,'cancel',row.version||1);
 const result=syncPending(repo,calendar,localTime);
 assert.equal(result.synced,1);assert.equal(calendar.events.size,0);
 assert.equal(repo.read().interactions[0].calendar_action.state,'cancelled');
 assert.equal(syncPending(repo,calendar,localTime).synced,0);
});
test('Calendar CRM: помилковий event_id не змінює і не видаляє особисту подію',()=>{
 for(const action of ['retry','cancel']){
  const {repo,calendar,service,interaction}=fixture();
  const personal=calendar.createEvent('Особиста зустріч',localTime(todo.date,todo.time),localTime(todo.date,'11:00'),{description:'Це не подія CRM'});
  const original={title:personal.title,description:personal.description,start:personal.start.getTime(),end:personal.end.getTime()};
  repo.transaction(state=>{
   const row=state.interactions[0];
   row.calendar_action.event_id=personal.id;
   row.calendar_action.sync_status='error';
  });
  if(action==='cancel'){
   const row=repo.read().interactions[0];
   service.updateCalendarAction(interaction.id,'cancel',row.version||1);
  }
  const result=syncPending(repo,calendar,localTime);
  assert.equal(result.failed,1);
  assert.equal(result.synced,0);
  assert.equal(calendar.created,1);
  assert.equal(calendar.events.size,1);
  assert.equal(personal.deleted,false);
  assert.equal(personal.title,original.title);
  assert.equal(personal.description,original.description);
  assert.equal(personal.start.getTime(),original.start);
  assert.equal(personal.end.getTime(),original.end);
  assert.equal(repo.read().interactions[0].calendar_action.sync_status,'error');
 }
});
test('Calendar CRM: скасування до створення не впливає на особисті події',()=>{
 const {repo,calendar,service,interaction}=fixture();
 const personal=calendar.createEvent('Особисте',localTime(todo.date,todo.time),localTime(todo.date,'11:00'),{description:'Приватне'});
 const row=repo.read().interactions[0];
 service.updateCalendarAction(interaction.id,'cancel',row.version||1);
 const result=syncPending(repo,calendar,localTime);
 assert.equal(result.synced,1);assert.equal(result.failed,0);
 assert.equal(calendar.created,1);assert.equal(calendar.events.size,1);
 assert.equal(personal.deleted,false);
});
test('Calendar CRM: помилка Google не втрачає дію; повтор із тим самим ID',()=>{
 const {repo,calendar,interaction,service}=fixture();
 calendar.createEvent=()=>{throw Error('Synthetic Calendar outage');};
 const result=syncPending(repo,calendar,localTime);
 assert.equal(result.failed,1);assert.equal(repo.read().interactions[0].calendar_action.sync_status,'error');
 const row=repo.read().interactions[0];service.updateCalendarAction(interaction.id,'retry',row.version);
 calendar.createEvent=FakeCalendar.prototype.createEvent;
 const retry=syncPending(repo,calendar,localTime);
 assert.equal(retry.synced,1);assert.equal(calendar.events.size,1);
});
test('Calendar CRM: неправильні дата, час, тривалість і нагадування блокуються до запису',()=>{
 const {repo,service,c}=fixture(),before=repo.read().interactions.length;
 for(const fields of [{date:'2026-02-30'},{time:'25:30'},{duration_minutes:-1},{reminder_minutes:999},{title:''}]){
  assert.throws(()=>service.addRelated('interactions',{client_id:c.id,summary:'Демо',calendar_action:{...todo,...fields}}));
 }
 assert.equal(repo.read().interactions.length,before);
});
test('Calendar CRM: наявний основний календар, дозвіл та явний RPC',()=>{
 const manifest=JSON.parse(fs.readFileSync('source/server/appsscript.json','utf8'));
 assert.ok(manifest.oauthScopes.includes('https://www.googleapis.com/auth/calendar'));
 const code=fs.readFileSync('source/server/Code.gs','utf8');
 assert.match(code,/function crmCalendarSync\(\)/);
 assert.match(code,/CRM_CALENDAR_ID/);
 assert.match(code,/isOwnedByMe/);
 assert.match(code,/getDefaultCalendar\(\)/);
 assert.match(code,/calendarId\?CalendarApp\.getCalendarById\(calendarId\):CalendarApp\.getDefaultCalendar\(\)/);
 const bundle=fs.readFileSync('scripts/bundle-server.js','utf8');
 assert.match(bundle,/source\/server\/calendar\.js/);
});

test('Calendar CRM: форма взаємодії має українські поля; HTML екранує назву події',()=>{
 const vm=require('node:vm'),D=require('../source/shared/domain');
 const context=vm.createContext({
  D,Intl,Date,window:{addEventListener(){}},document:{addEventListener(){}},
  escapeHtml:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
 });
 vm.runInContext(fs.readFileSync('source/web/m2.js','utf8'),context);
 const form=context.calendarActionForm();
 assert.match(form,/Додати робочу дію/);
 assert.match(form,/calendar_date/);
 assert.match(form,/calendar_time/);
 assert.match(form,/calendar_reminder/);
 const history=context.historyView([{id:'test',happened_at:'2026-11-05',summary:'Обговорення',type:'Дзвінок',calendar_action:{...todo,title:'<script>alert(1)</script>',state:'active',sync_status:'pending'}}]);
 assert.match(history,/Очікує синхронізації/);
 assert.match(history,/&lt;script>/);
 assert.doesNotMatch(history,/<script>/);
 assert.match(history,/data-calendar-cancel/);
});
