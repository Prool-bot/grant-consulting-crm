'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository,normalize}=require('../source/adapters/sheets');
const {CrmService,wireState}=require('../source/server/core');
const {syncPending}=require('../source/server/calendar');

const hash=s=>createHash('sha256').update(s).digest('hex');
const time=(date,clock)=>new Date(date+'T'+clock+':00+02:00');
const action={title:'Перевірити дедлайн',date:'2026-11-16',time:'11:30',duration_minutes:30,reminder_minutes:15};
function fixture(){
 const book=new FakeSheets();
 const factory=()=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash});
 factory().setup();
 const repo=factory();
 repo.migrate12(repo.read().revision,true);
 const service=new CrmService(repo,randomUUID);
 const client=service.saveClient({legal_name:'ГО «Синтетичний клієнт»',type:'ngo',status:'active'});
 const interaction=service.addRelated('interactions',{client_id:client.id,type:'Дзвінок',summary:'Синтетичний коментар: приватні дані не передавати',calendar_action:action});
 return {book,factory,repo,service,client,interaction};
}
class FakeCalendar{
 constructor(){this.events=new Map();this.serial=0;this.created=0;}
 getEventById(id){return this.events.get(id)||null;}
 getEvents(start,end,opts){return [...this.events.values()].filter(e=>e.start>=start&&e.start<=end&&e.description.includes(opts.search));}
 createEvent(title,start,end,options){
  this.created++;
  const e={
   id:'synthetic-event-'+(++this.serial),title,start,end,description:options.description,reminders:[],
   getId(){return this.id;},getDescription(){return this.description;},
   setDescription(value){this.description=value;},setTitle(value){this.title=value;},
   setTime(a,b){this.start=a;this.end=b;},setTag(){},setVisibility(){},
   removeAllReminders(){this.reminders=[];},addPopupReminder(n){this.reminders.push(n);},
   deleteEvent:()=>this.events.delete(e.id)
  };
  this.events.set(e.id,e);return e;
 }
}
test('CRM 1.4: календарна дія проходить Sheets journal, проєкцію, перезапуск і друкований стан без втрат',()=>{
 const {factory,repo,client,interaction}=fixture();
 const fresh=factory().read();
 const row=fresh.interactions.find(x=>x.id===interaction.id);
 assert.ok(row);
 assert.equal(row.version,1);
 assert.equal(row.calendar_action.sync_status,'pending');
 assert.equal(row.calendar_action.reminder_minutes,15);
 assert.equal(normalize(fresh).interactions[0].calendar_action.title,action.title);
 assert.equal(wireState(fresh).interactions[0].calendar_action.date,action.date);
 assert.equal(new CrmService(factory()).data().interactions[0].calendar_action.title,action.title);
 assert.equal(fresh.clients.find(x=>x.id===client.id).legal_name,'ГО «Синтетичний клієнт»');
});
test('CRM 1.4: Sheets → Calendar → Sheets, повторне читання і захист від дубля',()=>{
 const {factory,repo,interaction}=fixture(),calendar=new FakeCalendar();
 const first=syncPending(repo,calendar,time);
 assert.deepEqual(first,{synced:1,failed:0,pending:0});
 assert.equal(calendar.events.size,1);
 assert.equal(calendar.created,1);
 assert.deepEqual([...calendar.events.values()][0].reminders,[15]);
 const after=factory().read();
 assert.equal(after.interactions[0].calendar_action.sync_status,'synced');
 const id=after.interactions[0].calendar_action.event_id;
 assert.equal(calendar.getEventById(id).description.includes(interaction.id),true);
 const again=syncPending(factory(),calendar,time);
 assert.equal(again.synced,0);
 assert.equal(calendar.events.size,1);
 assert.equal(calendar.created,1);
 assert.equal(factory().read().interactions[0].calendar_action.event_id,id);
 assert.equal(factory().control().pending,null);
});
test('CRM 1.4: після невдалого Google Calendar запис залишається у Sheets для повтору',()=>{
 const {factory,repo,service,interaction}=fixture(),calendar=new FakeCalendar();
 calendar.createEvent=()=>{throw Error('Синтетичний збій Calendar');};
 const first=syncPending(repo,calendar,time);
 assert.equal(first.failed,1);
 const failed=factory().read().interactions[0];
 assert.equal(failed.calendar_action.sync_status,'error');
 assert.equal(failed.calendar_action.title,action.title);
 assert.equal(failed.calendar_action.event_id,'');
 service.updateCalendarAction(interaction.id,'retry',failed.version);
 calendar.createEvent=FakeCalendar.prototype.createEvent;
 const second=syncPending(factory(),calendar,time);
 assert.equal(second.synced,1);
 assert.equal(calendar.created,1);
 assert.equal(factory().read().interactions[0].calendar_action.sync_status,'synced');
});
