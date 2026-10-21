(function(root){
'use strict';
const Core=typeof module!=='undefined'?require('../server/core'):root.CrmCore;
function rpc(method,request){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(Error('Зв’язок перервано. Повторіть збереження без зміни полів; запит не створить дубль.')),45000);
  root.google.script.run.withSuccessHandler(response=>{clearTimeout(timer);if(response.ok)resolve(response.value);else reject(Object.assign(Error(response.message),{code:response.code}));})
   .withFailureHandler(()=>{clearTimeout(timer);reject(Error('Не вдалося підтвердити операцію. Повторіть збереження без зміни полів.'));})[method](request);
 });
}
class Service {
 constructor(call=rpc,uuid=()=>root.crypto.randomUUID()) {this.call=call;this.uuid=uuid;this.state=null;this.pending=null;this.busy=false;this.metrics=[];this.loading=false;}
 data(){return this.view||this.state;}
 listClients(options={}){
  const minute=Math.floor(Date.now()/60000);
  if(this.catalogMinute!==minute){this.catalogMinute=minute;this.catalogPages=new Map();}
  const key=JSON.stringify(options);
  if(!this.catalogPages.has(key)){if(this.catalogPages.size>=30)this.catalogPages.clear();this.catalogPages.set(key,this.reader.listClients(options));}
  return JSON.parse(JSON.stringify(this.catalogPages.get(key)));
 }
 record(operation,start,ok){this.metrics.push({operation,durationMs:Date.now()-start,ok});if(this.metrics.length>50)this.metrics.shift();}
 install(next){
  const repository=new Core.LocalRepository();repository.validate(next);repository.state=next;
  const reader=new Core.CrmService(repository),view=reader.data();
  const ids=new Set(view.clients.map(c=>c.id));
  for(const table of ['contacts','interactions'])view[table]=view[table].filter(r=>ids.has(r.client_id));
  this.state=next;this.reader=reader;this.view=view;this.catalogMinute=null;
 }
 async reload(){
  if(this.busy||this.loading)throw Error('Дочекайтеся завершення поточної операції.');
  this.loading=true;const start=Date.now();let ok=false;
  try{await this.loadSnapshot();ok=true;}finally{this.loading=false;this.record('reload',start,ok);}
 }
 async loadSnapshot(){
  const response=await this.call('crmQuery',{action:'bootstrap',args:{}});
  if(response.revision!==response.result?.revision)throw Error('Дані змінилися під час завантаження.');
  if(this.state && response.revision<this.state.revision)throw Error('Застаріла відповідь сервера.');
  this.install(response.result);
 }
 applySync(sync){
  if(sync.state){if(sync.state.revision<this.state.revision)throw Error('Застаріла відповідь сервера.');this.install(sync.state);return;}
  if(sync.baseRevision!==this.state.revision || sync.revision!==sync.baseRevision+1)throw Error('Неузгоджена ревізія відповіді.');
  const next={...this.state,revision:sync.revision,sequence:sync.sequence};
  for(const [table,rows] of Object.entries(sync.changes)){
    if(!Core.DATA_TABLES.includes(table)||!Array.isArray(rows)||new Set(rows.map(r=>r.id)).size!==rows.length)throw Error('Некоректні зміни сервера.');
    const updates=new Map(rows.map(r=>[r.id,r]));
    next[table]=this.state[table].map(r=>{const value=updates.get(r.id)||r;updates.delete(r.id);return value;}).concat([...updates.values()]);
  }
  this.install(next);
 }
 async mutate(action,args){
  if(this.busy||this.loading)throw Error('Дочекайтеся завершення попереднього запису.');
  const signature=JSON.stringify({action,args});
  if(this.pending&&this.pending.signature!==signature)throw Error('Попередній запис не підтверджено. Поверніть поля до попередніх значень і повторіть збереження перед іншими змінами.');
  if(!this.pending){
   // Та сама бізнес-валідація до мережевого виклику; зміни лише в тимчасовій копії.
   const repository=new Core.LocalRepository();repository.state=JSON.parse(JSON.stringify(this.state));
   const service=new Core.CrmService(repository,this.uuid);
   const argumentsByAction={saveCatalog:[args.table,args.input,args.id,args.version],removeCatalog:[args.table,args.id,args.version,args.confirmed],saveContact:[args.input,args.id,args.version],saveClient:[args.input,args.id,args.version],saveApplication:[args.input,args.id,args.version],clientAction:[args.id,args.action,args.confirmed],applicationAction:[args.id,args.action],deleteApplication:[args.id,args.confirmed],addRelated:[args.table,args.input]};
   service[action](...argumentsByAction[action]);
   this.pending={signature,request:JSON.parse(JSON.stringify({action,args,sync:true,revision:this.state.revision,requestId:this.uuid()})),acknowledged:false};
  }
  this.busy=true;const start=Date.now();let ok=false;
  try{
   if(!this.pending.acknowledged){this.pending.result=await this.call('crmMutate',this.pending.request);this.pending.acknowledged=true;}
   const response=this.pending.result;
   if(response?.protocol===1){
    try{this.applySync(response.sync);}catch{await this.loadSnapshot();}
   }else await this.loadSnapshot();
   const result=response?.protocol===1?response.result:response;this.pending=null;ok=true;return result;
  }catch(error){if(error.code==='CONFLICT'){this.pending=null;}throw error;}finally{this.busy=false;this.record(action,start,ok);}
 }
 saveCatalog(table,input,id,version){return this.mutate('saveCatalog',{table,input,id,version});}
 removeCatalog(table,id,version,confirmed){return this.mutate('removeCatalog',{table,id,version,confirmed});}
 saveContact(input,id,version){return this.mutate('saveContact',{input,id,version});}
 saveClient(input,id,version){return this.mutate('saveClient',{input,id,version});}
 saveApplication(input,id,version){return this.mutate('saveApplication',{input,id,version});}
 clientAction(id,action,confirmed=false){return this.mutate('clientAction',{id,action,confirmed});}
 applicationAction(id,action){return this.mutate('applicationAction',{id,action});}
 deleteApplication(id,confirmed){return this.mutate('deleteApplication',{id,confirmed});}
 addRelated(table,input){return this.mutate('addRelated',{table,input});}
}
const api={Service};if(typeof module!=='undefined')module.exports=api;else root.CrmRemote=api;
})(globalThis);
