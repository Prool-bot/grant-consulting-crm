const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {FakeSheets}=require('./helpers/fake-sheets');
const {SheetsRepository}=require('../source/adapters/sheets');
const Gateway=require('../source/server/gateway');
const {Service}=require('../source/web/remote');
const client={legal_name:'Демо: Інтеграція',type:'ngo',status:'active'};
const app={title:'Демо: Заявка',grant:'Демо: Конкурс',donor:'Демо: Донор',status:'preparation',currency:'EUR',amount:null};
function fixture(){
 const book=new FakeSheets();const hash=s=>createHash('sha256').update(s).digest('hex');
 const repo=options=>new SheetsRepository({spreadsheet:book,lock:book.lock(),flush:()=>book.flush(),hash,...options});repo().setup();repo().migrate12(0,true);
 const call=async(method,request)=>{try{return method==='crmQuery'?Gateway.query(repo(),request):Gateway.mutate(repo({expectedRevision:request.revision,request:{id:request.requestId,fingerprint:hash(JSON.stringify(request))}}),randomUUID,request);}catch(error){if(/Конфлікт|змінено або видалено/.test(error.message))error.code='CONFLICT';throw error;}};
 return {repo,call,service:new Service(call,randomUUID)};
}
test('Інтеграція UI → RPC → Sheets: створення, редагування, архів, відновлення, видалення та повторне відкриття',async()=>{
 const {service:s,call,repo}=fixture();await s.reload();assert.equal(s.data().clients.length,0);
 const c=await s.saveClient(client);const a=await s.saveApplication({...app,client_id:c.id});
 await s.saveClient({...client,legal_name:'Демо: Змінено'},c.id,c.version);
 await s.saveApplication({...app,client_id:c.id,status:'submitted'},a.id,a.version);
 await s.applicationAction(a.id,'archive');assert.ok(s.data().applications[0].archived_at);
 await s.applicationAction(a.id,'restore');assert.equal(s.data().applications[0].archived_at,null);
 await s.clientAction(c.id,'archive');assert.equal(s.data().clients[0].status,'archived');await s.clientAction(c.id,'restore');
 const reopened=new Service(call,randomUUID);await reopened.reload();assert.equal(reopened.data().applications[0].status,'submitted');
 await s.deleteApplication(a.id,true);assert.equal(s.data().applications.length,0);assert.ok(repo().read().applications[0].deleted_at);
 await s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Контакт'});
 await s.clientAction(c.id,'delete',true);assert.equal(s.data().clients.length,0);assert.equal(s.data().contacts.length,0);
 await s.saveClient(client);assert.equal(s.data().clients.length,1);
});
test('Втрачена відповідь після запису: незмінний UUID, змінений запит заблоковано, дубль відсутній',async()=>{
 const {call,repo}=fixture();let lose=true;const s=new Service(async(method,r)=>{const result=await call(method,r);if(method==='crmMutate'&&lose){lose=false;throw Error('Обрив');}return result;},randomUUID);
 await s.reload();await assert.rejects(s.saveClient(client));const id=s.pending.request.requestId;
 await assert.rejects(s.saveClient({...client,legal_name:'Демо: Інше'}),/Попередній/);assert.equal(s.pending.request.requestId,id);
 await s.saveClient(client);assert.equal(repo().read().clients.length,1);assert.equal(s.pending,null);
});
test('Збій перечитування після успішного запису повторює лише читання',async()=>{
 const {call}=fixture();let fail=false,writes=0;const s=new Service(async(m,r)=>{if(m==='crmMutate'){writes++;fail=true;const response=await call(m,r);response.sync.baseRevision=-1;return response;}else if(fail){fail=false;throw Error('Квота');}return call(m,r);},randomUUID);
 await s.reload();await assert.rejects(s.saveClient(client));assert.ok(s.pending.acknowledged);await s.saveClient(client);assert.equal(writes,1);
});
test('Конфлікт вкладок не перезаписує нові дані; валідація не надсилає запит',async()=>{
 const {call,service:s}=fixture();const other=new Service(call,randomUUID);await s.reload();await other.reload();
 await assert.rejects(s.saveClient({...client,legal_name:''}));assert.equal(s.pending,null);
 await s.saveClient(client);await assert.rejects(other.saveClient(client),{code:'CONFLICT'});assert.equal(other.pending,null);await other.reload();assert.equal(other.data().clients.length,1);
});
test('Понад 100 записів одним bootstrap та атомарна відмова неузгодженої відповіді',async()=>{
 let inconsistent=false;const rows=Array.from({length:201},(_,i)=>({...client,id:String(i),client_no:String(i+1),version:1}));
 const state={version:2,modelVersion:12,revision:1,sequence:201,clients:rows,applications:[],contacts:[],interactions:[],documents:[],partners:[],client_partners:[]};
 const s=new Service(async()=>({revision:inconsistent?2:1,result:state}));
 await s.reload();assert.equal(s.data().clients.length,201);const before=s.data();inconsistent=true;await assert.rejects(s.reload(),/змінилися/);assert.equal(s.data(),before);
});
test('Браузерний google.script.run: успіх, серверна відмова та транспортна помилка',async()=>{
 const vm=require('node:vm'),fs=require('node:fs');let mode='success';
 const context={CrmCore:require('../source/server/core'),crypto:{randomUUID},setTimeout,clearTimeout,google:{script:{get run(){
  let success,failure;return {withSuccessHandler(f){success=f;return this;},withFailureHandler(f){failure=f;return this;},crmQuery(){queueMicrotask(()=>mode==='transport'?failure(Error('private detail')):success(mode==='denied'?{ok:false,code:'UNAVAILABLE',message:'Доступ закрито.'}:{ok:true,value:{revision:0,result:{version:2,modelVersion:12,revision:0,sequence:0,clients:[],applications:[],contacts:[],interactions:[],documents:[],partners:[],client_partners:[]}}}));}};
 }}}};
 vm.createContext(context);vm.runInContext(fs.readFileSync(require.resolve('../source/web/remote'),'utf8'),context);
 const s=new context.CrmRemote.Service();await s.reload();assert.equal(s.data().clients.length,0);
 mode='denied';await assert.rejects(s.reload(),/Доступ закрито/);mode='transport';await assert.rejects(s.reload(),/Не вдалося підтвердити/);
});

test('Контакти UI → RPC → Sheets: оновлення без дубля, повтор після обриву, конфлікт і сталі заголовки',async()=>{
 const {call,repo,service:s}=fixture();await s.reload();const c=await s.saveClient(client);
 await s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Контакт',email:'demo@example.test'});
 const original=s.data().contacts[0],other=new Service(call,randomUUID);await other.reload();
 let lose=true;const retry=new Service(async(m,r)=>{const result=await call(m,r);if(m==='crmMutate'&&lose){lose=false;throw Error('Обрив');}return result;},randomUUID);await retry.reload();
 const input={...original,full_name:'Демо: Оновлено'};
 await assert.rejects(retry.saveContact(input,original.id,original.version),/Обрив/);
 await retry.saveContact(input,original.id,original.version);
 const stored=repo().read().contacts;assert.equal(stored.length,1);assert.equal(stored[0].id,original.id);assert.equal(stored[0].version,2);assert.equal(stored[0].created_at,original.created_at);
 await assert.rejects(other.saveContact({...original,full_name:'Демо: Конфлікт'},original.id,original.version),/Конфлікт/);
 assert.equal(repo().read().contacts[0].full_name,'Демо: Оновлено');
 const sheet=repo().sheet('contacts');assert.deepEqual(sheet.getRange(1,1,1,4).getValues()[0],['id','client_id','version','data_json']);
});
