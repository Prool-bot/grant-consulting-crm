'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const fs=require('node:fs');
const vm=require('node:vm');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository}=require('../source/adapters/sheets');
const {CrmService}=require('../source/server/core');

const source=fs.readFileSync('source/server/Code.gs','utf8');
const probe=source.slice(source.indexOf('function verifyCrmTestDatabaseIntegrity()'));
const pins=[...probe.matchAll(/var expected(?:Script|Id)Hash='([a-f0-9]{64})'/g)].map(x=>x[1]);
assert.equal(pins.length,2,'Missing staging or test sheet hash');
const [scriptHash,sheetHash]=pins;
const hash=s=>createHash('sha256').update(s).digest('hex');
function fixture({scriptValid=true,sheetValid=true,denyOwner=false}={}) {
 const book=new FakeSheets();
 const createRepo=()=>new SheetsRepository({
  spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash
 });
 createRepo().setup();
 createRepo().migrate12(0,true);
 new CrmService(createRepo(),randomUUID).saveClient({
  legal_name:'Синтетична тестова організація',type:'ngo',status:'active',
  sectors:['Вигадана галузь']
 });
 book.resetMetrics();book.calls=0;
 const logs=[],calls={opened:0,authorized:0,script:0};
 const ctx=vm.createContext({
  console:{log:text=>logs.push(String(text))},
  PropertiesService:{getScriptProperties:()=>({
   getProperty:key=>key==='CRM_SPREADSHEET_ID'?'synthetic-sheets-id':undefined
  })},
  ScriptApp:{getScriptId:()=>{calls.script++;return 'synthetic-script-id';}},
  CrmGateway:{authorize:()=>{
   calls.authorized++;
   if(denyOwner)throw Error('Private owner token');
  }},
  Session:{},
  CrmSheets:{SheetsRepository},
  SpreadsheetApp:{openById:()=>{calls.opened++;return book;}},
  LockService:{getScriptLock:()=>book.lock()}
 });
 vm.runInContext(source,ctx);
 ctx.crmHash_=value=>{
  if(value==='synthetic-script-id')return scriptValid?scriptHash:'mismatched-script';
  if(value==='synthetic-sheets-id')return sheetValid?sheetHash:'mismatched-sheet';
  return hash(value);
 };
 const run=()=>{
  vm.runInContext('verifyCrmTestDatabaseIntegrity()',ctx);
  assert.equal(book.calls,0,'unexpected writes to test spreadsheet');
  assert.equal(book.metrics.rangeWrites,0,'unexpected cell writes');
  assert.equal(book.metrics.flushes,0,'unexpected spreadsheet flush');
  assert.equal(book.held,false,'script lock not released');
  assert.ok(logs.every(line=>!line.includes('Синтетична тестова організація')));
 };
 return {book,logs,calls,run,ctx};
}
test('Integrity: verifies committed journal and nine projections with zero writes',()=>{
 const f=fixture();f.run();
 assert.deepEqual(f.logs,[
  'CRM_TEST_INTEGRITY_OK; schema=2; model=12; projectionTabs=9; dataLogged=0; writes=0'
 ]);
 assert.equal(f.calls.opened,1);
 assert.equal(f.calls.authorized,1);
 assert.ok(f.book.metrics.rangeReads>9);
});
test('Integrity: untrusted Apps Script blocked before owner auth and Sheets access',()=>{
 const f=fixture({scriptValid:false});f.run();
 assert.deepEqual(f.logs,['CRM_TEST_INTEGRITY_FAILED; code=TEST_SCRIPT_MISMATCH']);
 assert.equal(f.calls.opened,0);
 assert.equal(f.calls.authorized,0);
});
test('Integrity: unauthorized owner and wrong spreadsheet do not reveal private details',()=>{
 const denied=fixture({denyOwner:true});denied.run();
 assert.deepEqual(denied.logs,['CRM_TEST_INTEGRITY_FAILED; code=UNAVAILABLE']);
 assert.equal(denied.calls.opened,0);
 const wrong=fixture({sheetValid:false});wrong.run();
 assert.deepEqual(wrong.logs,['CRM_TEST_INTEGRITY_FAILED; code=TEST_SHEET_MISMATCH']);
 assert.equal(wrong.calls.opened,0);
});
test('Integrity: pending transaction aborts rather than recovering or writing Sheets',()=>{
 const f=fixture(),sheet=f.book.getSheetByName('_crm_control');
 const control=JSON.parse(sheet.getRange(2,1).getValue());
 control.pending=control.committed;
 const serialized=JSON.stringify(control);
 sheet.getRange(2,1).setValue(serialized);
 f.book.resetMetrics();f.book.calls=0;
 f.run();
 assert.deepEqual(f.logs,['CRM_TEST_INTEGRITY_FAILED; code=PENDING_TRANSACTION']);
 assert.equal(sheet.getRange(2,1).getValue(),serialized);
});
test('Integrity: missing committed journal fails closed',()=>{
 const f=fixture(),sheet=f.book.getSheetByName('_crm_control');
 const control=JSON.parse(sheet.getRange(2,1).getValue());
 control.committed=null;
 sheet.getRange(2,1).setValue(JSON.stringify(control));
 f.book.resetMetrics();f.book.calls=0;
 f.run();
 assert.deepEqual(f.logs,['CRM_TEST_INTEGRITY_FAILED; code=NO_COMMITTED_JOURNAL']);
});
test('Integrity: checksum damage is detected and raw journal contents are not logged',()=>{
 const f=fixture();
 const control=JSON.parse(f.book.getSheetByName('_crm_control').getRange(2,1).getValue());
 f.book.getSheetByName('_crm_journal').getRange(control.committed.start,1).setValue('j:synthetic-corruption');
 f.book.resetMetrics();f.book.calls=0;
 f.run();
 assert.deepEqual(f.logs,['CRM_TEST_INTEGRITY_FAILED; code=JOURNAL_INVALID']);
 assert.ok(!f.logs.join(' ').includes('synthetic-corruption'));
});
test('Integrity: out-of-band projection change is detected without repair',()=>{
 const f=fixture(),sheet=f.book.getSheetByName('clients');
 sheet.getRange(2,4).setValue('synthetic-manual-change');
 f.book.resetMetrics();f.book.calls=0;
 f.run();
 assert.deepEqual(f.logs,['CRM_TEST_INTEGRITY_FAILED; code=PROJECTION_MISMATCH']);
 assert.equal(sheet.getRange(2,4).getValue(),'synthetic-manual-change');
});
test('Integrity: Script ID hash matches protected staging workflow and schema check',()=>{
 const workflow=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
 const m=workflow.match(/const expectedStagingHash='([a-f0-9]{64})'/);
 assert.ok(m);
 assert.equal(scriptHash,m[1]);
 const sheetProbe=source.slice(source.indexOf('function verifyCrmTestSheetConnection()'),
  source.indexOf('function crmCalendarSync()'));
 assert.ok(sheetProbe.includes(sheetHash));
});
