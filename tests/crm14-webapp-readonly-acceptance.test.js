'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const read=p=>fs.readFileSync(p,'utf8');
const script=read('source/server/Code.gs');

function webEntry({authorized=true}={}){
 const calls={authorize:0,fromFile:0,denied:0,reads:0,writes:0};
 const context=vm.createContext({
  PropertiesService:{getScriptProperties:()=>({})},
  CrmGateway:{authorize:()=>{
   calls.authorize++;
   if(!authorized)throw Error('Private account detail');
  }},
  Session:{},
  HtmlService:{
   createHtmlOutputFromFile:filename=>{
    calls.fromFile++;
    assert.equal(filename,'Index');
    return {
     kind:'private-webapp',
     setTitle(title){assert.equal(title,'Каталог клієнтів');return this;},
     addMetaTag(name,value){
      assert.equal(name,'viewport');assert.equal(value,'width=device-width, initial-scale=1');
      return this;
     }
    };
   },
   createHtmlOutput:html=>{
    calls.denied++;return {kind:'denied',html};
   }
  },
  SpreadsheetApp:{openById:()=>{calls.reads++;throw Error('Unexpected Sheets access');}},
  CalendarApp:{getDefaultCalendar:()=>{calls.writes++;throw Error('Unexpected Calendar access');}}
 });
 vm.runInContext(script,context);
 return {result:vm.runInContext('doGet()',context),calls};
}
test('WebApp: only authorized owner renders Index, entry point never reads Sheets or Calendar',()=>{
 const result=webEntry({authorized:true});
 assert.equal(result.result.kind,'private-webapp');
 assert.deepEqual(result.calls,{authorize:1,fromFile:1,denied:0,reads:0,writes:0});
});
test('WebApp: unauthorized user receives generic denial without Index or private Google API access',()=>{
 const result=webEntry({authorized:false});
 assert.equal(result.result.kind,'denied');
 assert.match(result.result.html,/Доступ закрито/);
 assert.doesNotMatch(result.result.html,/Private account detail/);
 assert.deepEqual(result.calls,{authorize:1,fromFile:0,denied:1,reads:0,writes:0});
});
test('WebApp: head test route is private, with no production deployment or client data embedded',()=>{
 const m=JSON.parse(read('source/server/appsscript.json'));
 assert.deepEqual(m.webapp,{access:'MYSELF',executeAs:'USER_ACCESSING'});
 const html=read('source/web/index.html');
 const source=read('source/web/m2.js');
 const bootstrap=read('source/web/app.js');
 const build=read('scripts/build.js');
 assert.match(html,/href="#clients"/);
 assert.match(html,/href="#home"/);
 assert.match(html,/<main id="main"/);
 assert.match(source,/Пошук клієнтів/);
 assert.match(source,/Розширені фільтри/);
 assert.match(source,/Картка клієнта/);
 assert.match(source,/Огляд','Досьє','Контакти','Історія','Заявки','Документи','Партнери/);
 assert.match(source,/calendar-check/);
 assert.match(source,/calendar-sync/);
 assert.match(bootstrap,/startCrm\(\)/);
 assert.match(bootstrap,/await initializeCrm\(\)/);
 assert.match(build,/CRM_REMOTE=true/);
 assert.doesNotMatch(build,/clasp (?:create|update)-deployment/);
});
test('WebApp: remote client starts with bootstrap, not browser demo or writes',async()=>{
 const src=read('source/web/remote.js');
 assert.match(src,/action:'bootstrap'/);
 assert.match(src,/this\.call\('crmQuery',\{action:'bootstrap'/);
 assert.match(src,/withSuccessHandler/);
 const ctx=vm.createContext({
  CrmCore:{LocalRepository:class{},CrmService:class{}},
  google:{script:{run:{
   withSuccessHandler(){return this;},
   withFailureHandler(){return this;},
   crmQuery(request){
    assert.equal(request.action,'bootstrap');
   }
  }}},
  setTimeout,clearTimeout,Date,Promise
 });
 vm.runInContext(src,ctx);
 assert.equal(typeof ctx.CrmRemote?.Service,'function');
});
