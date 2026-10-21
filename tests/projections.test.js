'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture,BaselineRepository,benchmark,id}=require('./helpers/projection-benchmark');
const {SheetsRepository}=require('../source/adapters/sheets');
for(const size of [3,100,250,1000])test(`Проєкції: порівняння ${size} клієнтів із d5af840`,()=>{
 const before=benchmark(size,BaselineRepository),after=benchmark(size,SheetsRepository);
 for(const op of ['read','save']){
  assert.equal(after[op].rangeReads,before[op].rangeReads);
  assert.equal(after[op].rangeWrites,before[op].rangeWrites);
  assert.equal(after[op].flushes,before[op].flushes);
  assert.ok(after[op].lastRows<before[op].lastRows);
 }
 assert.equal(after.read.rangeReads,11);assert.equal(after.save.rangeReads,13);
 assert.equal(before.save.projectionRows,size*2);assert.equal(after.save.projectionRows,2);
 assert.equal(after.save.flushes,4);assert.equal(after.save.lookups,11);assert.equal(after.save.maxRows,1);
});
test('Проєкції: суміжні зміни об’єднані, незмінні рядки не записуються',()=>{
 const f=fixture(6);f.repo().transaction(s=>{for(const i of [0,1,4]){s.clients[i].version++;s.clients[i].catalog_note='Демо';}});
 assert.deepEqual(f.book.ranges.filter(r=>r.name==='clients').map(r=>[r.row,r.height]),[[2,2],[6,1]]);
 assert.equal(f.book.metrics.projectionRows,6);assert.equal(f.repo().read().clients.length,6);
});
test('Проєкції: створення, м’яке видалення, зменшення, перестановка та порожній стан',()=>{
 const f=fixture(3);
 f.repo().transaction(s=>{s.clients.push({...s.clients[0],id:id(4),client_no:'4'});s.sequence=4;});assert.equal(f.book.metrics.projectionRows,2);
 f.book.resetMetrics();f.repo().transaction(s=>{s.clients[1].deleted_at='2026-10-21T00:00:00Z';s.clients[1].version++;});assert.equal(f.book.metrics.projectionRows,2);
 f.repo().transaction(s=>{s.clients.reverse();});assert.equal(f.repo().read().clients[0].id,id(4));
 // Лише синтетична імітація скорочення проєкцій при відновленні старого знімка.
 f.repo().transaction(s=>{s.clients=s.clients.slice(0,1);});assert.equal(f.repo().read().clients.length,1);
 f.repo().transaction(s=>{s.clients=[];});assert.equal(f.repo().read().clients.length,0);
});
test('Проєкції: кожен аркуш перевіряється, зайві рядки та заголовки не приховуються кешем',()=>{
 for(const name of ['clients','client_profiles','contacts','interactions','grants','applications','documents','partners','client_partners'])for(const kind of ['header','tail','extraColumn']){
  const f=fixture(),r=f.repo();r.read();const sheet=f.book.getSheetByName(name);
  if(kind==='header')sheet.getRange(1,1).setValue('Демо зміна');
  else sheet.getRange(20,kind==='tail'?1:5).setValue('Демо сторонній рядок');
  f.book.arm(0);assert.throws(()=>r.read(),/структура|поза CRM/);assert.equal(f.book.calls,0);assert.equal(r.sheetHandles,null);
 }
 const f=fixture(),r=f.repo();r.read();f.book.sheets.delete('clients');assert.throws(()=>r.read(),/не налаштовано/);
});
test('Проєкції: усі межі часткових діапазонів, росту й очищення відновлюються без дубля',()=>{
 const changes=[s=>{for(const i of [0,2]){s.clients[i].catalog_note='Демо';s.clients[i].version++;}},s=>{s.clients.push({...s.clients[0],id:id(4),client_no:'4'});s.sequence=4;},s=>{s.clients=s.clients.slice(0,1);}];
 for(const change of changes){
  function scenario(at,after){
   const f=fixture();for(const sheet of f.book.sheets.values())sheet.maxRows=sheet.lastRow();
   const request={id:id(999),fingerprint:'synthetic'},r=f.repo({request});f.book.arm(at,after);
   try{r.transaction(change);}catch{}
   const count=f.book.calls;f.book.arm(0);r.transaction(change);const state=f.repo().read();
   assert.equal(state.receipts.filter(x=>x.id===request.id).length,1);assert.equal(state.revision,3);assert.equal(f.book.held,false);
   return {count,state};
  }
  const expected=scenario(0,false);for(let at=1;at<=expected.count;at++)for(const after of [false,true])assert.deepEqual(scenario(at,after).state,expected.state);
 }
});

test('Проєкції: повторні збої під час повного recovery часткового запису',()=>{
 function scenario(at,after){
  const f=fixture(),request={id:id(998),fingerprint:'synthetic-recovery'};
  const change=s=>{for(const i of [0,2]){s.clients[i].version++;s.clients[i].catalog_note='Демо';}};
  f.book.arm(5,true);assert.throws(()=>f.repo({request}).transaction(change));
  f.book.arm(at,after);try{f.repo().read();}catch{}const count=f.book.calls;
  f.book.arm(0);const state=f.repo().read();f.repo({request}).transaction(change);
  assert.deepEqual(f.repo().read(),state);assert.equal(state.receipts.length,1);assert.equal(state.clients[2].catalog_note,'Демо');return count;
 }
 const count=scenario(0,false);for(let at=1;at<=count;at++)for(const after of [false,true])scenario(at,after);
});
