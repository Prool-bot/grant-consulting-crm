'use strict';
// Лише синтетичний FakeSheets. Історичний код читається з Git, мережа не використовується.
const {execFileSync}=require('node:child_process'),Module=require('node:module'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto'),{performance}=require('node:perf_hooks');
const {FakeSheets}=require('../tests/helpers/fake-sheets');
const base='130d1e7';
function historical(file){const name=path.resolve(__dirname,'..',file),m=new Module(name,module);m.filename=name;m.paths=Module._nodeModulePaths(path.dirname(name));m._compile(execFileSync('git',['show',base+':'+file],{encoding:'utf8'}),name);return m.exports;}
const hash=s=>createHash('sha256').update(s).digest('hex');
async function run(label,SheetsRepository,Service,Gateway){
 const book=new FakeSheets(),repo=options=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash,...options});repo().setup();repo().migrate12(0,true);
 repo().transaction(s=>{s.sequence=250;s.clients=Array.from({length:250},(_,i)=>({id:randomUUID(),client_no:String(i+1),version:1,legal_name:'Демо організація '+i,type:'ngo',status:'active'}));const c=s.clients[0].id,p=randomUUID();
 s.contacts=[{id:randomUUID(),client_id:c,version:1,full_name:'Демо контакт'}];s.interactions=[{id:randomUUID(),client_id:c,version:1,summary:'Демо розмова'}];
 s.applications=[{id:randomUUID(),client_id:c,version:1,title:'Демо',grant:'Демо',donor:'Демо',status:'won',currency:'EUR'}];
 s.partners=[{id:p,version:1,name:'Демо партнер',type:'ngo'}];s.client_partners=[{id:randomUUID(),client_id:c,partner_id:p,version:1,status:'active',memorandum:false,support_letter:false}];
 s.documents=[{id:randomUUID(),client_id:c,version:1,title:'Демо документ',category:'other',url:'https://drive.google.com/file/d/synthetic-document/view'}];});
 let rpc=0,bytes=0;const service=new Service(async(method,r)=>{rpc++;const result=method==='crmQuery'?Gateway.query(repo(),r):Gateway.mutate(repo({expectedRevision:r.revision,request:{id:r.requestId,fingerprint:hash(JSON.stringify(r))}}),randomUUID,r);bytes+=Buffer.byteLength(JSON.stringify(result));return result;},randomUUID);
 async function measure(operation,action){book.reads=0;book.calls=0;rpc=0;bytes=0;const start=performance.now();await action();return {version:label,operation,rpc,rangeReads:book.reads,writesAndFlushes:book.calls,responseBytes:bytes,localMs:Math.round((performance.now()-start)*100)/100};}
 const rows=[await measure('reload',()=>service.reload())];const c=service.data().clients[0];rows.push(await measure('saveClient',()=>service.saveClient({legal_name:c.legal_name,type:c.type,status:c.status,catalog_note:'Демо примітка'},c.id,c.version)));
 return rows;
}
(async()=>{const before=await run(base,historical('source/adapters/sheets.js').SheetsRepository,historical('source/web/remote.js').Service,historical('source/server/gateway.js'));const after=await run('current',require('../source/adapters/sheets').SheetsRepository,require('../source/web/remote').Service,require('../source/server/gateway'));console.table([...before,...after]);console.log('localMs — локальна імітація без мережі, не час Google Apps Script. RPC/читання/обсяг — детерміновані лічильники.');})().catch(error=>{console.error(error.message);process.exitCode=1;});
