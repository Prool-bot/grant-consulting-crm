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
 constructor(call=rpc,uuid=()=>root.crypto.randomUUID()) {this.call=call;this.uuid=uuid;this.state=null;this.pending=null;this.busy=false;}
 data(){return this.state;}
 listClients(options){const repository=new Core.LocalRepository();repository.state=this.state;return new Core.CrmService(repository).listClients(options);}
 async reload(){
  // Сторінки публікуються в інтерфейсі лише після перевірки спільної ревізії.
  const next={version:2,sequence:0};let revision;
  for(const table of ['clients','applications','contacts','interactions']){
   next[table]=[];let page=0,result;
   do{const response=await this.call('crmQuery',{action:'listData',args:{table,page,limit:100}});
    if(revision!==undefined&&revision!==response.revision)throw Error('Дані змінилися під час завантаження. Повторіть оновлення.');
    revision=response.revision;result=response.result;next[table].push(...result.items);page++;
   }while(next[table].length<result.total);
  }
  next.revision=revision;next.sequence=Math.max(0,...next.clients.map(c=>Number(c.client_no)));this.state=next;
 }
 async mutate(action,args){
  if(this.busy)throw Error('Дочекайтеся завершення попереднього запису.');
  const signature=JSON.stringify({action,args});
  if(this.pending&&this.pending.signature!==signature)throw Error('Попередній запис не підтверджено. Поверніть поля до попередніх значень і повторіть збереження перед іншими змінами.');
  if(!this.pending){
   // Та сама бізнес-валідація до мережевого виклику; зміни лише в тимчасовій копії.
   const repository=new Core.LocalRepository();repository.state=JSON.parse(JSON.stringify(this.state));
   const service=new Core.CrmService(repository,this.uuid);
   const argumentsByAction={saveContact:[args.input,args.id,args.version],saveClient:[args.input,args.id,args.version],saveApplication:[args.input,args.id,args.version],clientAction:[args.id,args.action,args.confirmed],applicationAction:[args.id,args.action],deleteApplication:[args.id,args.confirmed],addRelated:[args.table,args.input]};
   service[action](...argumentsByAction[action]);
   this.pending={signature,request:JSON.parse(JSON.stringify({action,args,revision:this.state.revision,requestId:this.uuid()})),acknowledged:false};
  }
  this.busy=true;
  try{
   if(!this.pending.acknowledged){this.pending.result=await this.call('crmMutate',this.pending.request);this.pending.acknowledged=true;}
   await this.reload();const result=this.pending.result;this.pending=null;return result;
  }catch(error){if(error.code==='CONFLICT'){this.pending=null;}throw error;}finally{this.busy=false;}
 }
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
