'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const Core=require('../source/server/core'),Gateway=require('../source/server/gateway');
const {SheetsRepository}=require('../source/adapters/sheets'),{Service}=require('../source/web/remote');
const {FakeSheets}=require('./helpers/fake-sheets');
const client={legal_name:'Демо: швидкість',type:'ngo',status:'active'};
function fixture(){
 const book=new FakeSheets(),hash=s=>createHash('sha256').update(s).digest('hex');
 const repo=options=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash,...options});repo().setup();repo().migrate12(0,true);
 const calls=[];const call=async(method,r)=>{calls.push({method,action:r.action});return method==='crmQuery'?Gateway.query(repo(),r):Gateway.mutate(repo({expectedRevision:r.revision,request:{id:r.requestId,fingerprint:hash(JSON.stringify(r))}}),randomUUID,r);};
 return {book,repo,call,calls,service:new Service(call,randomUUID)};
}
test('Швидкість: bootstrap одним RPC/11 читаннями діапазонів, без журналу в відповіді',async()=>{
 const f=fixture();f.book.reads=0;await f.service.reload();assert.equal(f.calls.length,1);assert.equal(f.book.reads,11);
 assert.equal(f.service.state.modelVersion,12);assert.equal(f.repo().control().schema,2);assert.equal(f.service.state.receipts,undefined);assert.equal(f.service.state.migration12,undefined);
 assert.deepEqual(Object.keys(f.service.metrics[0]).sort(),['durationMs','ok','operation']);
});
test('Швидкість: усі записи одним RPC, дельти дорівнюють повному стану, кеш інвалідується',async()=>{
 const f=fixture(),s=f.service;await s.reload();
 async function write(action){const n=f.calls.length;const result=await action();assert.equal(f.calls.length,n+1);assert.deepEqual(s.state,Core.wireState(f.repo().read()));return result;}
 const c=await write(()=>s.saveClient(client));s.listClients({query:'швидкість'});assert.equal(s.catalogPages.size,1);
 await write(()=>s.saveClient({...client,legal_name:'Демо: зміна'},c.id,c.version));assert.equal(s.listClients({query:'швидкість'}).total,0);
 const a=await write(()=>s.saveApplication({client_id:c.id,title:'Демо',grant:'Демо',donor:'Демо',currency:'EUR',status:'won'}));
 const contact=await write(()=>s.addRelated('contacts',{client_id:c.id,full_name:'Демо контакт'}));
 await write(()=>s.saveContact({client_id:c.id,full_name:'Демо змінено'},contact.id,1));
 const p=await write(()=>s.saveCatalog('partners',{name:'Демо партнер',type:'ngo'}));
 const link=await write(()=>s.saveCatalog('client_partners',{client_id:c.id,partner_id:p.id,status:'active',memorandum:false,support_letter:false}));
 const doc=await write(()=>s.saveCatalog('documents',{client_id:c.id,title:'Демо документ',category:'other',url:'https://drive.google.com/file/d/synthetic-document/view'}));
 await write(()=>s.removeCatalog('documents',doc.id,doc.version,true));await write(()=>s.removeCatalog('client_partners',link.id,link.version,true));await write(()=>s.deleteApplication(a.id,true));
 await write(()=>s.clientAction(c.id,'delete',true));assert.equal(s.data().contacts.length,0);
});
test('Повтор після втрати відповіді повертає також чужі нові зміни без дубля',async()=>{
 const f=fixture();let lose=true;const s=new Service(async(m,r)=>{const result=await f.call(m,r);if(m==='crmMutate'&&lose){lose=false;throw Error('Обрив');}return result;},randomUUID);
 await s.reload();await assert.rejects(s.saveClient(client));
 const other=new Service(f.call,randomUUID);await other.reload();await other.saveClient({...client,legal_name:'Демо інший'});
 await s.saveClient(client);assert.equal(s.state.clients.length,2);assert.deepEqual(s.state,Core.wireState(f.repo().read()));assert.equal(s.pending,null);
});
test('Повторні читання не кешують пошкодження аркушів чи журналу',()=>{
 const f=fixture(),r=f.repo();r.read();const sheet=f.book.getSheetByName('clients');sheet.getRange(2,1,1,4).setValues([['сторонній','','','']]);assert.throws(()=>r.read(),/поза CRM/);
 const g=fixture(),reader=g.repo();reader.read();const pointer=reader.control().committed;g.book.getSheetByName('_crm_journal').getRange(pointer.start,1).setValue('j:пошкоджено');assert.throws(()=>reader.read(),/сума/);
});
test('Дельта не публікується частково при неправильних зв’язках/ревізії',async()=>{
 const f=fixture(),s=f.service;await s.reload();const before=s.state;
 assert.throws(()=>s.applySync({baseRevision:999,revision:1000,sequence:0,changes:{}}));
 assert.throws(()=>s.applySync({baseRevision:before.revision,revision:before.revision+1,sequence:0,changes:{contacts:[{id:'demo',client_id:'missing'}]}}));assert.equal(s.state,before);
});
test('Оптимізований запис: збій ДО/ПІСЛЯ кожної межі, повтор без дубля та з повним станом',async()=>{
 async function scenario(at,after){const f=fixture(),s=f.service;await s.reload();f.book.arm(at,after);try{await s.saveClient(client);}catch{}const count=f.book.calls;f.book.arm(0);if(s.pending)await s.saveClient(client);assert.equal(f.repo().read().clients.length,1);assert.deepEqual(s.state,Core.wireState(f.repo().read()));return count;}
 const count=await scenario(0,false);for(let i=1;i<=count;i++)for(const after of [false,true])await scenario(i,after);
});
test('Паралельне reload/mutate не може застосувати застарілу відповідь',async()=>{
 const f=fixture();let release;const s=new Service(async(m,r)=>{await new Promise(resolve=>release=resolve);return f.call(m,r);});const pending=s.reload();await assert.rejects(s.reload(),/Дочекайтеся/);await assert.rejects(s.saveClient(client),/Дочекайтеся/);release();await pending;
});
