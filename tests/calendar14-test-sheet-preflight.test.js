'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('source/server/Code.gs','utf8');
const hashMatch=source.match(/var expectedIdHash='([a-f0-9]{64})';/);
if(!hashMatch)throw Error('Missing pinned isolated test sheet hash');
const pinnedHash=hashMatch[1];
const scriptMatch=source.match(/var expectedScriptHash='([a-f0-9]{64})';/);
if(!scriptMatch)throw Error('Missing pinned isolated staging Script ID hash');
const scriptHash=scriptMatch[1];
const names=['clients','client_profiles','contacts','interactions',
 'grants','applications','documents','partners','client_partners'];
function fixture({environment,hash=pinnedHash,currentScriptHash=scriptHash,badHeader=false,throwRead=false}={}){
 const logs=[],ranges=[],counters={opened:0,authorized:0,scriptChecks:0};
 const scripts={CRM_ENVIRONMENT:environment,CRM_SPREADSHEET_ID:'synthetic-private-sheet-id'};
 const sheet=name=>({
  getName:()=>name,
  getRange:(row,col,numRows,numCols)=>{
   ranges.push({name,row,col,numRows,numCols});
   if(row!==1||col!==1)throw Error('Read attempt outside header!');
   return {
    getValues:()=>{
     if(throwRead)throw Error('private Google API error');
     const h=['id','client_id','version','data_json'];
     if(badHeader&&name===names[0])h[0]='wrong';
     return [h];
    },
    getValue:()=>{
     if(throwRead)throw Error('private Google API error');
     return name==='_crm_control'?'control_json':'chunk';
    }
   };
  }
 });
 const context=vm.createContext({
  console:{log:v=>logs.push(String(v))},
  PropertiesService:{getScriptProperties:()=>({getProperty:key=>scripts[key]})},
  ScriptApp:{getScriptId:()=>{counters.scriptChecks++;return 'synthetic-staging-script-id';}},
  CrmGateway:{authorize:()=>{counters.authorized++;}},
  SpreadsheetApp:{openById:()=>{counters.opened++;return {getSheets:()=>[...names,'_crm_control','_crm_journal'].map(sheet)};}},
  Session:{},
 });
 vm.runInContext(source,context);
 context.crmHash_=id=>id==='synthetic-staging-script-id'?currentScriptHash:hash;
 return {run:()=>vm.runInContext('verifyCrmTestSheetConnection()',context),logs,ranges,counters};
}
test('isolated test sheet preflight: staging Script ID and headers, no environment flag required',()=>{
 const f=fixture();f.run();
 assert.deepEqual(f.logs,['CRM_TEST_SHEET_OK; entityTabs=9; control=1; journal=1; recordRowsRead=0; writes=0']);
 assert.equal(f.counters.opened,1);
 assert.equal(f.counters.authorized,1);
 assert.equal(f.counters.scriptChecks,1);
 assert.equal(f.ranges.length,11);
 assert.ok(f.ranges.every(r=>r.row===1&&r.col===1));
});
test('test sheet preflight rejects production or unknown script ID before any API access',()=>{
 const f=fixture({environment:'production',currentScriptHash:'wrong-script-id-hash'});f.run();
 assert.deepEqual(f.logs,['CRM_TEST_SHEET_FAILED; code=TEST_SCRIPT_MISMATCH']);
 assert.equal(f.counters.opened,0);
 assert.equal(f.counters.authorized,0);
 assert.equal(f.counters.scriptChecks,1);
});
test('test sheet preflight pin matches protected CI staging script hash',()=>{
 const workflow=fs.readFileSync('.github/workflows/apps-script-staging.yml','utf8');
 const match=workflow.match(/const expectedStagingHash='([a-f0-9]{64})'/);
 assert.ok(match);
 assert.equal(scriptHash,match[1]);
});
test('test sheet preflight permits missing environment flag only on pinned staging Script',()=>{
 const f=fixture({environment:undefined});f.run();
 assert.match(f.logs[0],/^CRM_TEST_SHEET_OK/);
});
test('test sheet preflight denies unknown spreadsheet ID before opening it',()=>{
 const f=fixture({hash:'wrong-test-sheet-id-hash'});f.run();
 assert.deepEqual(f.logs,['CRM_TEST_SHEET_FAILED; code=TEST_SHEET_MISMATCH']);
 assert.equal(f.counters.opened,0);
});
test('test sheet preflight rejects schema changes without returning any data',()=>{
 const f=fixture({badHeader:true});f.run();
 assert.deepEqual(f.logs,['CRM_TEST_SHEET_FAILED; code=SCHEMA_MISMATCH']);
});
test('test sheet preflight redacts Google API errors',()=>{
 const f=fixture({throwRead:true});f.run();
 assert.deepEqual(f.logs,['CRM_TEST_SHEET_FAILED; code=UNAVAILABLE']);
 assert.ok(!f.logs.join('\n').includes('private Google API error'));
});
