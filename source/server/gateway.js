(function(root) {
'use strict';
const Core=typeof module!=='undefined'?require('./core'):root.CrmCore;
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
function authorize(properties,session) {
  const owner=properties.getProperty('CRM_OWNER_EMAIL')?.trim().toLowerCase();
  if(properties.getProperty('CRM_ENABLED')!=='true' || !owner ||
    session.getEffectiveUser().getEmail().toLowerCase()!==owner ||
    session.getActiveUser().getEmail().toLowerCase()!==owner) throw Error('Доступ закрито.');
  // Основна межа доступу — MYSELF + USER_ACCESSING у розгортанні Google.
  // Email — додаткова перевірка; порожня ідентичність завжди означає відмову.
}
function page(rows,options={}) {
  const limit=Math.max(1,Math.min(100,Number.isInteger(options.limit)?options.limit:20));
  const index=Math.max(0,Number.isInteger(options.page)?options.page:0);
  return {items:rows.slice(index*limit,(index+1)*limit),total:rows.length,page:index,limit};
}
function query(repository,request) {
  const state=repository.read();
  if(request.action==='bootstrap')return {revision:state.revision,result:Core.wireState(state)};
  const local=new Core.LocalRepository();local.state=state;
  const service=new Core.CrmService(local), data=service.data(), args=request.args||{};
  let result;
  switch(request.action) {
    case 'listData':
      if(!['clients','applications','contacts','interactions',...Core.COLLECTIONS].includes(args.table))throw Error('Невідомий розділ.');
      if(Core.COLLECTIONS.includes(args.table)&&state.modelVersion!==12)throw Error('CRM12_MIGRATION_REQUIRED');
      result=page(args.includeDeleted===true?state[args.table]:data[args.table].filter(row=>!['contacts','interactions'].includes(args.table)||data.clients.some(c=>c.id===row.client_id)),args);break;
    case 'listClients': result=service.listClients(args);break;
    case 'listApplications': result=page(data.applications.filter(a=>!args.client_id||a.client_id===args.client_id),args);break;
    case 'getClient': result=data.clients.find(c=>c.id===args.id)||null;break;
    case 'getApplication': result=data.applications.find(a=>a.id===args.id)||null;break;
    case 'listRelated':
      if(!['contacts','interactions'].includes(args.table))throw Error('Невідомий розділ.');
      result=page(data.clients.some(c=>c.id===args.client_id)?data[args.table].filter(r=>r.client_id===args.client_id):[],args);break;
    default: throw Error('Невідома дія.');
  }
  return {revision:state.revision,result};
}
function mutate(repository,uuid,request) {
  if(!UUID.test(request.requestId)||!Number.isSafeInteger(request.revision)||request.revision<0)throw Error('Потрібні UUID запиту та ревізія.');
  const target=request.sync===true?{transaction:change=>repository.transaction(state=>{if(state.modelVersion!==12)throw Error('CRM12_MIGRATION_REQUIRED');return change(state);},true)}:repository;
  const service=new Core.CrmService(target,uuid), a=request.args||{};
  // Для видалення/архівування М2 не мав аргументу версії: сервер вимагає
  // ревізію всього стану, яка перевіряється під тим самим ScriptLock.
  switch(request.action) {
    case 'saveCatalog': return service.saveCatalog(a.table,a.input,a.id,a.version);
    case 'removeCatalog': return service.removeCatalog(a.table,a.id,a.version,a.confirmed);
    case 'saveContact': return service.saveContact(a.input,a.id,a.version);
    case 'saveClient': return service.saveClient(a.input,a.id,a.version);
    case 'saveApplication': return service.saveApplication(a.input,a.id,a.version);
    case 'clientAction': return service.clientAction(a.id,a.action,a.confirmed===true);
    case 'applicationAction': return service.applicationAction(a.id,a.action);
    case 'deleteApplication': return service.deleteApplication(a.id,a.confirmed===true);
    case 'addRelated': return service.addRelated(a.table,a.input);
    default: throw Error('Невідома дія.');
  }
}
const api={authorize,query,mutate};
if(typeof module!=='undefined')module.exports=api;else root.CrmGateway=api;
})(globalThis);
