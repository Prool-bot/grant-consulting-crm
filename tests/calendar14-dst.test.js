'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Імітація двох реальних UTC-зсувів Києва; жодного доступу до Google-акаунта.
const formatter=new Intl.DateTimeFormat('en-GB',{
 timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',hourCycle:'h23'
});
const local=d=>{
 const p=Object.fromEntries(formatter.formatToParts(d).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day+' '+p.hour+':'+p.minute;
};
const parseLocal=value=>{
 const millis=Date.parse(value.replace(' ','T')+':00Z');
 for(const offset of [2,3]){
  const candidate=new Date(millis-offset*3600000);
  if(local(candidate)===value)return candidate;
 }
 // Так Utilities.parseDate може нормалізувати неіснуючу весняну годину.
 return new Date(millis-7200000);
};
const context=vm.createContext({
 CrmDomain:{dateOnly:day=>/^\\d{4}-\\d{2}-\\d{2}$/.test(day)&&
   Number.isFinite(Date.parse(day+'T00:00:00Z'))&&
   new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day},
 Utilities:{parseDate:(value,zone,pattern)=>{
  assert.equal(zone,'Europe/Kyiv');assert.equal(pattern,'yyyy-MM-dd HH:mm');
  return parseLocal(value);
 },formatDate:(date,zone,pattern)=>{
  assert.equal(zone,'Europe/Kyiv');assert.equal(pattern,'yyyy-MM-dd HH:mm');
  return local(date);
 }}
});
vm.runInContext(fs.readFileSync('source/server/Code.gs','utf8'),context);
const convert=(day,time)=>context.crmCalendarLocalTime_(day,time);

test('Calendar: існуючий зимовий і літній час Києва зберігають правильну дату та UTC',()=>{
 assert.equal(convert('2026-11-12','10:30').toISOString(),'2026-11-12T08:30:00.000Z');
 assert.equal(convert('2026-07-15','10:30').toISOString(),'2026-07-15T07:30:00.000Z');
 assert.equal(convert('2026-10-25','04:30').toISOString(),'2026-10-25T02:30:00.000Z');
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
