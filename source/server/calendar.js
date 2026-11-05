(function(root){
'use strict';
// Синхронізація CRM → основний календар власника. Події створюються тільки з дій у взаємодіях.
// Кожен крок із Sheets — окрема транзакція; зовнішній API НІКОЛИ не викликається під ScriptLock.
const MARK='CRM-ACTION:';
// Точний збіг окремого рядка: префікс UUID іншої події не є доказом належності CRM.
const hasMarker=(event,token)=>typeof event?.getDescription==='function' &&
 String(event.getDescription()||'').split(/\r?\n/).some(line=>line.trim()===token);
const clone=value=>JSON.parse(JSON.stringify(value));
const eligible=(action,now)=>{
 if(!action)return false;
 if(action.sync_status==='pending'||action.sync_status==='error')return true;
 return action.sync_status==='syncing'&&Number.isFinite(Date.parse(action.sync_started_at||''))&&now-Date.parse(action.sync_started_at)>5*60*1000;
};
function syncPending(repository,calendar,localTime,now=()=>new Date(),limit=5) {
 if(!calendar)throw Error('CALENDAR_NOT_CONFIGURED');
 if(typeof localTime!=='function')throw Error('CALENDAR_TIME_PARSER_MISSING');
 let synced=0,failed=0;
 const processed=new Set(),max=Math.max(1,Math.min(10,limit));
 for(let i=0;i<max;i++){
  const clock=now(),clockMs=clock.getTime();
  const rows=repository.read().interactions;
  const candidate=rows.find(row=>!processed.has(row.id)&&eligible(row.calendar_action,clockMs));
  if(!candidate)break;
  processed.add(candidate.id);
  let claimed=null;
  repository.transaction(state=>{
   const row=state.interactions.find(r=>r.id===candidate.id);
   if(!row||!eligible(row.calendar_action,clockMs))return null;
   row.calendar_action={...row.calendar_action,sync_status:'syncing',sync_started_at:clock.toISOString()};
   row.version=(row.version||1)+1;row.updated_at=clock.toISOString();
   claimed=clone(row);
   return null;
  });
  if(!claimed)continue;
  const task=claimed.calendar_action,token=MARK+claimed.id;
  try {
   let event=task.event_id?calendar.getEventById(task.event_id):null;
   // Ніколи не редагувати чи видаляти події, які не належать CRM:
   // event_id може бути помилковим або зміненим у таблиці.
   if(event && !hasMarker(event,token)) {
     throw Error('CALENDAR_EVENT_ID_MISMATCH');
   }
   // Збережені старі дії без time_zone тлумачимо за Kyiv; нові містять Istanbul.
   const start=localTime(task.date,task.time,task.time_zone||'Europe/Kyiv');
   if(!(start instanceof Date)||!Number.isFinite(start.getTime()))throw Error('CALENDAR_INVALID_TIME');
   const end=new Date(start.getTime()+task.duration_minutes*60000);
   if(!event){
    // Після збою між createEvent та збереженням event_id відновлюємо подію за стабільною міткою.
    const found=calendar.getEvents(new Date(start.getTime()-86400000),new Date(end.getTime()+86400000),{search:token})||[];
    event=found.find(e=>hasMarker(e,token))||null;
   }
   let id=task.event_id||'';
   if(task.state==='cancelled'){
     if(event)event.deleteEvent();
     id='';
   }else{
     const clientName=repository.read().clients.find(c=>c.id===claimed.client_id)?.legal_name||'Клієнт';
     const title=task.title+' — '+clientName;
     const description='Робоча дія з CRM. Без конфіденційного тексту коментаря.\n'+token;
     if(event){
       event.setTitle(title);event.setTime(start,end);event.setDescription(description);
     }else event=calendar.createEvent(title,start,end,{description});
     // Відсутність квитанції на попередньому кроці не повинна створювати дубль.
     if(typeof event.setTag==='function')event.setTag('crm_action_id',claimed.id);
     if(typeof event.setVisibility==='function')event.setVisibility(root.CalendarApp?.Visibility?.PRIVATE||'PRIVATE');
     event.removeAllReminders();
     if(task.reminder_minutes>0)event.addPopupReminder(task.reminder_minutes);
     id=event.getId();
   }
   repository.transaction(state=>{
     const row=state.interactions.find(r=>r.id===claimed.id);
     if(!row||row.calendar_action?.sync_status!=='syncing'||row.calendar_action.sync_started_at!==task.sync_started_at)throw Error('CALENDAR_CONCURRENT_UPDATE');
     row.calendar_action={...row.calendar_action,event_id:id,sync_status:'synced',sync_started_at:null,synced_at:now().toISOString(),error_code:''};
     row.version=(row.version||1)+1;row.updated_at=now().toISOString();
     return null;
   });
   synced++;
  }catch(error){
   failed++;
   // Не повертати власнику незахищені повідомлення API, ID чи реквізити подій.
   repository.transaction(state=>{
     const row=state.interactions.find(r=>r.id===claimed.id);
     if(row&&row.calendar_action?.sync_status==='syncing'&&row.calendar_action.sync_started_at===task.sync_started_at){
       row.calendar_action={...row.calendar_action,sync_status:'error',sync_started_at:null,error_code:'SYNC_FAILED'};
       row.version=(row.version||1)+1;row.updated_at=now().toISOString();
     }
     return null;
   });
  }
 }
 return {synced,failed,pending:repository.read().interactions.filter(r=>r.calendar_action&&r.calendar_action.sync_status!=='synced').length};
}
const api={syncPending};
if(typeof module!=='undefined')module.exports=api;else root.CrmCalendar=api;
})(globalThis);
