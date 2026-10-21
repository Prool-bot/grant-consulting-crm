'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createHash,randomUUID}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
test('Apps Script: зібраний сервер проходить налаштування, RPC CRUD, повтор, конфлікт і закриття доступу',()=>{
  // Збираємо в пам’яті, щоб паралельні тестові файли не переписували спільний dist.
  const server=require('../scripts/bundle-server')();
  const book=new FakeSheets(),properties={CRM_ENABLED:'true',CRM_OWNER_EMAIL:'owner@example.invalid',CRM_SPREADSHEET_ID:'synthetic-only'};
  let identity='owner@example.invalid',opens=0;const timingLogs=[];
  const context={
    console:{log:value=>timingLogs.push(value)},
    PropertiesService:{getScriptProperties:()=>({getProperty:k=>properties[k]})},
    Session:{getActiveUser:()=>({getEmail:()=>identity}),getEffectiveUser:()=>({getEmail:()=>identity})},
    SpreadsheetApp:{openById:id=>{assert.equal(id,'synthetic-only');opens++;return book;},flush:()=>book.flush()},
    LockService:{getScriptLock:()=>book.lock()},
    Utilities:{getUuid:randomUUID,DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(algorithm,text)=>[...createHash(algorithm).update(text).digest()]},
    HtmlService:{createHtmlOutput:html=>html,createHtmlOutputFromFile:name=>({setTitle(){return this;},addMetaTag(){return name;}})}
  };
  vm.createContext(context);
  vm.runInContext(server,context);
  vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../source/server/Code.gs'),'utf8'),context);
  assert.equal(context.doGet(),'Index');
  assert.equal(context.setupCrm_().ok,true);assert.equal(context.setupCrm_().ok,true);
  const request={requestId:randomUUID(),revision:0,action:'saveClient',args:{input:{legal_name:'Демо: RPC',type:'ngo',status:'active'}}};
  const created=context.crmMutate(request);assert.equal(created.ok,true);assert.equal(context.crmMutate(request).value.id,created.value.id);
  const list=context.crmQuery({action:'listClients'});assert.equal(list.value.result.total,1);assert.equal(list.value.revision,1);
  assert.equal(context.crmMutate({...request,requestId:randomUUID()}).code,'CONFLICT');
  const denied=context.crmMutate({...request,requestId:randomUUID(),revision:1,action:'restore'});assert.equal(denied.ok,false);
  assert.equal(context.backupCrm_().ok,true);
  assert.equal(context.crmQuery({action:'listData',args:{table:'documents'}}).code,'MIGRATION_REQUIRED');
  assert.equal(context.migrateCrm12_(1,true).ok,true);
  assert.equal(context.inspectCrm12_().value.modelVersion,12);
  const docRequest={requestId:randomUUID(),revision:2,action:'saveCatalog',args:{table:'documents',input:{client_id:created.value.id,title:'Демо: Документ',category:'other',url:'https://docs.google.com/document/d/synthetic-document/edit'}}};
  assert.equal(context.crmMutate(docRequest).ok,true);
  assert.equal(context.crmMutate(docRequest).ok,true);
  assert.equal(context.inspectCrm12_().value.counts.documents,1);
  assert.equal(context.CrmDomain.normalizeUrl('https://example.invalid/grant'),'https://example.invalid/grant');
  const bootstrap=context.crmQuery({action:'bootstrap'});assert.equal(bootstrap.ok,true);assert.equal(bootstrap.value.result.receipts,undefined);assert.equal(bootstrap.value.result.documents.length,1);
  const syncRequest={requestId:randomUUID(),revision:bootstrap.value.revision,sync:true,action:'saveClient',args:{id:created.value.id,version:1,input:{legal_name:'Демо: RPC',type:'ngo',status:'active',catalog_note:'Демо'}}};
  const synced=context.crmMutate(syncRequest);assert.equal(synced.ok,true);assert.equal(synced.value.protocol,1);assert.equal(synced.value.sync.changes.clients.length,1);assert.equal(context.crmMutate(syncRequest).value.sync.state.clients.length,1);
  context.crmQuery({action:'bootstrap',diagnostics:true});assert.equal(timingLogs.length,0);
  properties.CRM_DIAGNOSTICS_ENABLED='true';properties.CRM_ENVIRONMENT='production';context.crmQuery({action:'bootstrap'});assert.equal(timingLogs.length,0);
  properties.CRM_ENVIRONMENT='test';assert.equal(context.crmQuery({action:'bootstrap'}).ok,true);assert.equal(timingLogs.length,1);
  const timing=JSON.parse(timingLogs[0]);assert.ok(timing.stages.lock_wait);assert.ok(timing.stages.sheets_verify);assert.doesNotMatch(timingLogs[0],/synthetic-only|example.invalid|Демо|requestId/);
  const count=opens;identity='other@example.invalid';
  assert.equal(context.crmQuery({action:'bootstrap'}).ok,false);assert.equal(context.crmMutate(syncRequest).ok,false);assert.equal(context.crmQuery({action:'listClients'}).ok,false);assert.equal(context.crmMutate(request).ok,false);
  assert.equal(context.migrateCrm12_(1,true).ok,false);assert.equal(context.inspectCrm12_().ok,false);assert.equal(context.crmMutate(docRequest).ok,false);assert.equal(context.setupCrm_().ok,false);assert.equal(context.backupCrm_().ok,false);assert.equal(opens,count);
  assert.match(context.doGet(),/Доступ закрито/);assert.equal(timingLogs.length,1);
  const safe=context.crmSafe_(()=>{throw Error('synthetic-sensitive-marker');});assert.doesNotMatch(JSON.stringify(safe),/synthetic-sensitive-marker/);
});
