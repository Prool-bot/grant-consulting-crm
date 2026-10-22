'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const {fixture}=require('./helpers/projection-benchmark');
for(const mode of ['data_range','bounded_range']){
 test(`Читання ${mode}: усі аркуші, заголовок, змінений/відсутній рядок і стороння колонка`,()=>{
  for(const name of ['clients','client_profiles','contacts','interactions','grants','applications','documents','partners','client_partners'])for(const kind of ['header','tail','outside']){
   const f=fixture(),r=f.repo({diagnostics:{enabled:true,projectionReadMode:mode,emit:()=>{}}});r.read();
   const sheet=f.book.getSheetByName(name);sheet.getRange(kind==='header'?1:30,kind==='outside'?20:1).setValue('Демо стороннє');
   f.book.arm(0);assert.throws(()=>r.read(),/структура|поза CRM/);assert.equal(f.book.calls,0);
  }
  for(const remove of [true,false]){const f=fixture();const sheet=f.book.getSheetByName('clients');if(remove)sheet.getRange(3,1,1,4).clearContent();else sheet.getRange(2,4).setValue('Демо');assert.throws(()=>f.repo({diagnostics:{enabled:true,projectionReadMode:mode,emit:()=>{}}}).read(),/поза CRM/);}
 });
 test(`Читання ${mode}: порожня база та широкий аркуш, однаковий стан`,()=>{
  for(const size of [0,3,100,250,1000]){
   const f=fixture(size),expected=f.repo().read();f.book.getSheetByName('clients').getRange(1,40).setValue('Демо');f.book.resetMetrics();
   const reports=[];const actual=f.repo({diagnostics:{enabled:true,projectionReadMode:mode,emit:r=>reports.push(r)}}).read();
   assert.deepEqual(actual,expected);assert.equal(f.book.metrics.rangeReads,11);assert.equal(f.book.metrics.lastRows,mode==='bounded_range'?9:0);assert.equal(f.book.metrics.rangeWrites,0);assert.equal(reports[0].projectionReadMode,mode);
  }
 });
}
test('Тестовий перемикач і ручне порівняння закриті без прапорців; pending не відновлюється',()=>{
 const context={console:{log:()=>{}}};vm.createContext(context);vm.runInContext(fs.readFileSync('source/server/Code.gs','utf8'),context);
 for(const env of ['test','production',undefined])for(const enabled of ['true','false'])for(const mode of ['data_range','bounded_range','invalid',undefined]){
  const props={getProperty:k=>({CRM_ENVIRONMENT:env,CRM_DIAGNOSTICS_ENABLED:enabled,CRM_PROJECTION_READ_MODE:mode})[k]};
  if(env==='test'&&enabled==='true'){if(mode==='invalid')assert.throws(()=>context.crmDiagnostics_(props));else assert.equal(context.crmDiagnostics_(props).projectionReadMode,mode||'bounded_range');}
  else assert.equal(context.crmDiagnostics_(props),null);
 }
 const f=fixture();context.crmRepository_=()=>f.repo();assert.throws(()=>context.benchmarkCrmRead_(),/тестового/);
 for(const mode of ['data_range','bounded_range']){
  context.crmRepository_=()=>f.repo({diagnostics:{enabled:true,projectionReadMode:mode,emit:()=>{}}});f.book.arm(0);context.benchmarkCrmRead_();assert.equal(f.book.calls,0);
 }
 const control=f.repo().control();control.pending=control.committed;f.book.getSheetByName('_crm_control').getRange(2,1).setValue(JSON.stringify(control));f.book.arm(0);assert.throws(()=>context.benchmarkCrmRead_(),/відновлення/);assert.equal(f.book.calls,0);
});

test('Робочий режим: bounded_range без таймерів, звітів або тестового перемикання',()=>{
 const f=fixture();let calls=0;
 for(const diagnostics of [null,{enabled:false,projectionReadMode:'data_range',clock:()=>++calls,emit:()=>calls++}]){
  const r=f.repo({diagnostics});f.book.resetMetrics();r.read();assert.equal(r.projectionReadMode,'bounded_range');assert.equal(f.book.metrics.lastRows,9);assert.equal(calls,0);assert.equal(r.timings,undefined);
 }
});
