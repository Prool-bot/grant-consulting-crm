'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository}=require('../source/adapters/sheets');
const Gateway=require('../source/server/gateway');
const {Service}=require('../source/web/remote');
const {syncPending}=require('../source/server/calendar');

// Повний синтетичний ланцюг CRM UI -> RPC -> Sheets journal/projection -> Calendar.
// У цьому тесті немає зовнішніх Google API та реальних клієнтських даних.
const hash=s=>createHash('sha256').update(s).digest('hex');
const action={
 title:'Синтетична дія CRM 1.4',date:'2026-11-12',time:'10:00',
 time_zone:'Europe/Istanbul',duration_minutes:15,reminder_minutes:5
};
const localTime=(day,time,zone)=>{
 assert.ok(['Europe/Istanbul','Europe/Kyiv'].includes(zone));
 return new Date(day+'T'+time+':00'+(zone==='Europe/Istanbul'?'+03:00':'+02:00'));
};
class CalendarEvent {
 constructor(calendar,title,start,end,options){
  this.calendar=calendar;this.id='synthetic-'+(++calendar.serial);
  this.title=title;this.start=start;this.end=end;
  this.description=options.description||'';this.reminders=[];this.deleted=false;
  this.failReceipt=false;
 }
 getId(){if(this.failReceipt){this.failReceipt=false;throw Error('Synthetic lost Calendar receipt');}return this.id;}
 getDescription(){return this.description;}
 setTitle(title){this.title=title;}
 setTime(start,end){this.start=start;this.end=end;}
 setDescription(desc){this.description=desc;}
 setTag(){}
 setVisibility(){}
 removeAllReminders(){this.reminders=[];}
 addPopupReminder(n){this.reminders.push(n);}
 deleteEvent(){this.deleted=true;this.calendar.events.delete(this.id);}
}
class CalendarMock {
 constructor(){this.events=new Map();this.serial=0;this.created=0;this.receiptFailure=false;}
 createEvent(title,start,end,options){
  this.created++;
  const event=new CalendarEvent(this,title,start,end,options);
  if(this.receiptFailure){event.failReceipt=true;this.receiptFailure=false;}
  this.events.set(event.id,event);
  return event;
 }
 getEventById(id){return this.events.get(id)||null;}
 getEvents(start,end,options){
  return [...this.events.values()].filter(e=>e.start>=start&&e.start<=end&&
    e.description.includes(options.search));
 }
}
function fixture(){
 const book=new FakeSheets();
 const repo=options=>new SheetsRepository({
  spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash,...options
 });
 repo().setup();repo().migrate12(0,true);
 const call=async(method,request)=>{
  try{
   return method==='crmQuery'
    ?Gateway.query(repo(),request)
    :Gateway.mutate(repo({
      expectedRevision:request.revision,
      request:{id:request.requestId,fingerprint:hash(JSON.stringify(request))}
     }),randomUUID,request);
  }catch(e){if(/Конфлікт|змінено або видалено/.test(e.message||''))e.code='CONFLICT';throw e;}
 };
 return {repo,service:new Service(call,randomUUID),calendar:new CalendarMock()};
}
async function setupAction(f){
 await f.service.reload();
 const c=await f.service.saveClient({
  legal_name:'Синтетичний клієнт — без приватних даних',type:'ngo',status:'active'
 });
 const row=await f.service.addRelated('interactions',{
  client_id:c.id,type:'Дзвінок',summary:'Синтетична перевірка',
  calendar_action:action
 });
 return {client:c,interaction:row};
}
test('E2E UI -> RPC -> Google Sheets model -> Calendar: Стамбул, нагадування, повтор, скасування',async()=>{
 const f=fixture(),{interaction}=await setupAction(f);
 const before=f.repo().read();
 assert.equal(before.interactions.length,1);
 assert.equal(before.interactions[0].calendar_action.time_zone,'Europe/Istanbul');
 assert.equal(before.interactions[0].calendar_action.sync_status,'pending');
 assert.equal(f.calendar.created,0);
 const result=syncPending(f.repo(),f.calendar,localTime);
 assert.equal(result.failed,0);assert.equal(result.synced,1);
 assert.equal(f.calendar.created,1);assert.equal(f.calendar.events.size,1);
 const event=[...f.calendar.events.values()][0];
 assert.equal(event.start.toISOString(),'2026-11-12T07:00:00.000Z');
 assert.equal(event.end.toISOString(),'2026-11-12T07:15:00.000Z');
 assert.deepEqual(event.reminders,[5]);
 assert.ok(event.description.split('\n').includes('CRM-ACTION:'+interaction.id));
 assert.equal(syncPending(f.repo(),f.calendar,localTime).synced,0);
 assert.equal(f.calendar.created,1);
 // Дані після повторного UI bootstrap мають те саме event_id.
 await f.service.reload();
 const synced=f.service.data().interactions[0];
 assert.equal(synced.calendar_action.event_id,event.id);
 assert.equal(synced.calendar_action.sync_status,'synced');
 await f.service.updateCalendarAction(synced.id,'cancel',synced.version);
 const cancelled=syncPending(f.repo(),f.calendar,localTime);
 assert.equal(cancelled.failed,0);assert.equal(cancelled.synced,1);
 assert.equal(f.calendar.events.size,0);
 assert.equal(f.repo().read().interactions[0].calendar_action.state,'cancelled');
 assert.equal(f.calendar.created,1);
});
test('E2E UI -> Sheets -> Calendar: збій після створення не дублює подію',async()=>{
 const f=fixture();await setupAction(f);
 f.calendar.receiptFailure=true;
 const first=syncPending(f.repo(),f.calendar,localTime);
 assert.equal(first.synced,0);assert.equal(first.failed,1);
 assert.equal(f.calendar.created,1);assert.equal(f.calendar.events.size,1);
 assert.equal(f.repo().read().interactions[0].calendar_action.sync_status,'error');
 const again=syncPending(f.repo(),f.calendar,localTime);
 assert.equal(again.synced,1);assert.equal(again.failed,0);
 assert.equal(f.calendar.created,1);assert.equal(f.calendar.events.size,1);
 assert.equal(f.repo().read().interactions[0].calendar_action.sync_status,'synced');
});
