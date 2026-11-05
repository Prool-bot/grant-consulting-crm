'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('CRM calendar preflight: показує OK, не торкаючись Sheets',()=>{
 const logs=[];
 const sandbox={
  console:{log:s=>logs.push(s)},
  crmCalendarCheck:()=>({ok:true,value:{ready:true,primary:true,timeZone:'Europe/Kyiv'}})
 };
 vm.createContext(sandbox);
 const source=fs.readFileSync('source/server/Code.gs','utf8');
 const functionText=source.slice(source.indexOf('function verifyCrmCalendarAccess_()'),source.indexOf('function crmCalendarSync()'));
 assert.ok(functionText.startsWith('function verifyCrmCalendarAccess_()'));
 vm.runInContext(functionText+'\nverifyCrmCalendarAccess_();',sandbox);
 assert.equal(logs[0],'CRM_CALENDAR_CHECK_OK; primary=true; timeZone=Europe/Kyiv');
});
test('CRM calendar preflight: відмова відображає лише код',()=>{
 const logs=[];
 const sandbox={
  console:{log:s=>logs.push(s)},
  crmCalendarCheck:()=>({ok:false,code:'UNAVAILABLE',message:'Private test details'})
 };
 vm.createContext(sandbox);
 const source=fs.readFileSync('source/server/Code.gs','utf8');
 const functionText=source.slice(source.indexOf('function verifyCrmCalendarAccess_()'),source.indexOf('function crmCalendarSync()'));
 vm.runInContext(functionText+'\nverifyCrmCalendarAccess_();',sandbox);
 assert.equal(logs[0],'CRM_CALENDAR_CHECK_FAILED; code=UNAVAILABLE');
 assert.equal(logs.join(' ').includes('Private test details'),false);
});
