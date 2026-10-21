'use strict';
const {createHash}=require('node:crypto');
const {SheetsRepository,normalize}=require('../../source/adapters/sheets');
const {FakeSheets}=require('./fake-sheets');
const Core=require('../../source/server/core');
const HEADER=['id','client_id','version','data_json'];
const tablesFor=s=>['clients','client_profiles','contacts','interactions','grants','applications',...(s.modelVersion===12?Core.COLLECTIONS:[])];
// Алгоритми проєкцій із d5af840: фіксована база порівняння, без Git/мережі в CI.
class BaselineRepository extends SheetsRepository {
 sheet(name){const s=this.spreadsheet.getSheetByName(name);if(!s)throw Error('Базу не налаштовано.');return s;}
 verifyProjection(state){
  const expected=normalize(state);
  for(const name of tablesFor(state)){
   const sheet=this.sheet(name),count=sheet.getLastRow()-1;
   const values=sheet.getRange(1,1,Math.max(1,count+1),HEADER.length).getValues();
   if(JSON.stringify(values[0])!==JSON.stringify(HEADER))throw Error('Несумісна структура аркушів.');
   const wanted=expected[name].map(r=>[r.id,r.client_id||'',r.version,JSON.stringify(r)]);
   if(JSON.stringify(values.slice(1))!==JSON.stringify(wanted))throw Error('Аркуші змінено поза CRM.');
  }
 }
 project(state,previousState=null){
  const tables=normalize(state),previousTables=previousState?normalize(previousState):null;
  for(const name of tablesFor(state)){
   if(previousTables&&JSON.stringify(tables[name])===JSON.stringify(previousTables[name]))continue;
   const sheet=this.sheet(name),rows=tables[name].map(r=>[r.id,r.client_id||'',r.version,JSON.stringify(r)]);
   if(rows.some(r=>r[3].length>45000))throw Error('Завелика комірка');
   const previous=sheet.getLastRow()-1;
   if(rows.length+1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
   if(rows.length)sheet.getRange(2,1,rows.length,4).setValues(rows);
   if(previous>rows.length)sheet.getRange(rows.length+2,1,previous-rows.length,4).clearContent();
  }
  this.flush();
 }
}
const id=i=>'00000000-0000-4000-8000-'+String(i).padStart(12,'0');
function fixture(size=3,Repository=SheetsRepository){
 const book=new FakeSheets(),repo=options=>new Repository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash:s=>createHash('sha256').update(s).digest('hex'),...options});
 repo().setup();repo().migrate12(0,true);
 repo().transaction(s=>{s.sequence=size;s.clients=Array.from({length:size},(_,i)=>({id:id(i+1),client_no:String(i+1),version:1,legal_name:'Демо '+i,type:'ngo',status:'active'}));});
 book.resetMetrics();return {book,repo};
}
function benchmark(size,Repository){
 const {book,repo}=fixture(size,Repository);repo().read();const read={...book.metrics};book.resetMetrics();
 repo().transaction(s=>{s.clients[Math.floor(size/2)].catalog_note='Демо зміна';s.clients[Math.floor(size/2)].version++;});
 return {read,save:{...book.metrics}};
}
module.exports={fixture,BaselineRepository,benchmark,id};
