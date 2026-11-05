'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Імітація реальних часових поясів Києва (+02/+03) та Стамбула (+03); без Google.
const formatter=zone=>new Intl.DateTimeFormat('en-GB',{
 timeZone:zone,
 year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
const local=(d,zone)=>{
 const p=Object.fromEntries(formatter(zone).formatToParts(d).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
};
const parseLocal=(value,zone)=>{
 const millis=Date.parse(value.replace(' ','T')+':00Z');
 for(const offset of (zone==='Europe/Istanbul'?[3]:[2,3])){
  const candidate=new Date(millis-offset*3600000);
  if(local(candidate,zone)===value)return candidate;
 }
 // Так Utilities.parseDate може нормалізувати неіснуючу весняну годину.
 return new Date(millis-(zone==='Europe/Istanbul'?10800000:7200000));
};
const context=vm.createContext({
 CrmDomain:{dateOnly:day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&
   Number.isFinite(Date.parse(day+'T00:00:00Z'))&&
   new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day},
 Utilities:{parseDate:(value,zone,pattern)=>{
  assert.ok(['Europe/Kyiv','Europe/Istanbul'].includes(zone));assert.equal(pattern,'yyyy-MM-dd HH:mm');
  return parseLocal(value,zone);
 },formatDate:(date,zone,pattern)=>{
  assert.ok(['Europe/Kyiv','Europe/Istanbul'].includes(zone));assert.equal(pattern,'yyyy-MM-dd HH:mm');
  return local(date,zone);
 }}
});
vm.runInContext(fs.readFileSync('source/server/Code.gs','utf8'),context);
const convert=(day,time,zone)=>context.crmCalendarLocalTime_(day,time,zone);

test('Calendar: існуючий зимовий і літній час Києва зберігають правильну дату та UTC',()=>{
 assert.equal(convert('2026-11-12','10:30').toISOString(),'2026-11-12T08:30:00.000Z');
 assert.equal(convert('2026-07-15','10:30').toISOString(),'2026-07-15T07:30:00.000Z');
 assert.equal(convert('2026-10-25','04:30').toISOString(),'2026-10-25T02:30:00.000Z');
});

test('Calendar: час Стамбула UTC+3 влітку і взимку, включно з датами переходу Києва',()=>{
 assert.equal(convert('2026-11-12','10:30','Europe/Istanbul').toISOString(),'2026-11-12T07:30:00.000Z');
 assert.equal(convert('2026-07-15','10:30','Europe/Istanbul').toISOString(),'2026-07-15T07:30:00.000Z');
 assert.equal(convert('2026-03-29','03:30','Europe/Istanbul').toISOString(),'2026-03-29T00:30:00.000Z');
 assert.equal(convert('2026-10-25','03:30','Europe/Istanbul').toISOString(),'2026-10-25T00:30:00.000Z');
});

test('Calendar: неіснуюча весняна година і двозначна осіння година не створюють дату',()=>{
 assert.throws(()=>convert('2026-03-29','03:30'),/CALENDAR_INVALID_TIME/);
 assert.throws(()=>convert('2026-10-25','03:30'),/CALENDAR_INVALID_TIME/);
});

test('Calendar: невалідні дата і час блокуються до виклику Google Calendar',()=>{
 assert.throws(()=>convert('2026-02-30','10:30'),/CALENDAR_INVALID_TIME/);
 assert.throws(()=>convert('2026-11-12','25:30'),/CALENDAR_INVALID_TIME/);
 assert.throws(()=>convert('2026-11-12','10:99'),/CALENDAR_INVALID_TIME/);
});

test('Apps Script crmMutate відхиляє неоднозначну дату до запису у сховище',()=>{
 let repositories=0,writes=0;
 context.crmRepository_=()=>{repositories++;return 'synthetic-repository';};
 context.CrmGateway={mutate:(repo,uuid,request)=>{
  writes++;assert.equal(repo,'synthetic-repository');return request;
 }};
 context.Utilities.getUuid=()=> 'synthetic-id';
 const input=(date,time)=>({action:'addRelated',args:{table:'interactions',input:{
  calendar_action:{title:'Тест',date,time,time_zone:'Europe/Kyiv',duration_minutes:30,reminder_minutes:15}
 }}});
 for(const [date,time] of [['2026-03-29','03:30'],['2026-10-25','03:30']]){
  const result=context.crmMutate(input(date,time));
  assert.equal(result.ok,false);
  assert.equal(result.code,'CALENDAR_INVALID_TIME');
  assert.match(result.message,/Виберіть іншу годину/);
 }
 assert.equal(repositories,0);
 assert.equal(writes,0);
 const valid=context.crmMutate(input('2026-10-25','04:30'));
 assert.equal(valid.ok,true);
 assert.equal(repositories,1);
 assert.equal(writes,1);
});

test('Apps Script crmMutate: час Стамбула 03:30 на датах переходу Києва допустимий',()=>{
 let writes=0;
 context.crmRepository_=()=> 'synthetic-repository';
 context.CrmGateway={mutate:()=>{writes++;return 'synthetic-ok';}};
 for(const day of ['2026-03-29','2026-10-25']){
  const r=context.crmMutate({action:'addRelated',args:{table:'interactions',input:{
   calendar_action:{title:'Тест',date:day,time:'03:30',time_zone:'Europe/Istanbul',duration_minutes:30,reminder_minutes:15}
  }}});
  assert.equal(r.ok,true);
 }
 assert.equal(writes,2);
});

test('Apps Script crmMutate без календарної дії не потребує дозволу Google Calendar',()=>{
 let writes=0;
 context.crmRepository_=()=>({isolate:true});
 context.CrmGateway={mutate:()=>{writes++;return 'synthetic-ok';}};
 context.Utilities.getUuid=()=> 'synthetic-id';
 const result=context.crmMutate({action:'addRelated',args:{table:'contacts',input:{full_name:'Тестовий контакт'}}});
 assert.equal(result.ok,true);
 assert.equal(result.value,'synthetic-ok');
 assert.equal(writes,1);
});
