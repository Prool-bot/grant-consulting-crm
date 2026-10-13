(function(root) {
'use strict';
const D = typeof module !== 'undefined' ? require('../shared/domain') : root.CrmDomain;
const clone = value => JSON.parse(JSON.stringify(value));
const statuses = { assessment:'Оцінювання', preparation:'У роботі', review:'Перевірка', submitted:'Подано · рішення очікується', rejected:'Відхилено', won:'Виграно', stopped:'Зупинено' };
const empty = () => ({version:2, revision:0, sequence:0, clients:[], applications:[], contacts:[], interactions:[]});
class LocalRepository {
  constructor(storage = null) { this.storage = storage; this.key = 'crm-m2-synthetic-v2'; const raw = storage?.getItem(this.key); this.state = raw ? JSON.parse(raw) : empty(); this.validate(this.state); }
  validate(s) {
    if(s.version !== 2 || !Number.isInteger(s.revision) || !Number.isInteger(s.sequence)) throw Error('Некоректна версія сховища.');
    for(const table of ['clients','applications','contacts','interactions']) {
      if(!Array.isArray(s[table]) || new Set(s[table].map(r=>r.id)).size !== s[table].length || s[table].some(r=>!r.id)) throw Error('Некоректні записи сховища.');
    }
    if(new Set(s.clients.map(c=>c.client_no)).size !== s.clients.length || s.clients.some(c=>!/^\d+$/.test(c.client_no) || Number(c.client_no)>s.sequence || Object.keys(D.validateClient(c)).length)) throw Error('Некоректні клієнти.');
    for(const table of ['applications','contacts','interactions']) if(s[table].some(r=>!s.clients.some(c=>c.id===r.client_id))) throw Error('Порушено зв’язок із клієнтом.');
    for(const a of s.applications) validateApplication(a);
  }
  read() { return clone(this.state); }
  transaction(change) {
    const raw = this.storage?.getItem(this.key);
    if(raw && JSON.parse(raw).revision !== this.state.revision) throw Error('Дані змінено в іншій вкладці. Оновіть сторінку перед повторною зміною.');
    const next = this.read(); const result = change(next); next.revision++; this.validate(next);
    // Спочатку надійний запис; помилка квоти не змінює поточний стан.
    try { this.storage?.setItem(this.key, JSON.stringify(next)); } catch { throw Error('Не вдалося зберегти: сховище недоступне або заповнене. Дані форми залишено.'); }
    this.state = next; return clone(result ?? null);
  }
  snapshot() { return JSON.stringify(this.state); }
  restore(snapshot) { const next = JSON.parse(snapshot); this.validate(next); return this.transaction(s=>{ const revision=s.revision; Object.assign(s,next,{revision,sequence:Math.max(s.sequence,next.sequence)}); }); }
}
function validateApplication(a) {
  if(!a.title?.trim() || !a.grant?.trim() || !a.donor?.trim() || !Object.hasOwn(statuses,a.status)) throw Error('Вкажіть назву заявки, грант, донора та статус.');
  if(!['EUR','UAH','USD','GBP'].includes(a.currency)) throw Error('Оберіть валюту.');
  for(const k of ['amount','award_amount']) if(a[k] != null && (typeof a[k] !== 'number' || !Number.isFinite(a[k]) || a[k]<0)) throw Error('Сума має бути невід’ємним числом.');
  for(const k of ['deadline','submission_at','donor_reply_at']) if(a[k] && !D.validDate(a[k])) throw Error('Дата має містити час і часовий пояс, наприклад 2026-10-28T18:00:00+02:00.');
}
class CrmService {
  constructor(repository, uuid = D.uuid) { this.repository=repository; this.uuid=uuid; }
  initialize(seed) { if(this.repository.read().clients.length) return; this.repository.transaction(s=>{ s.clients=clone(seed.clients).map(c=>({...c,version:1})); s.contacts=seed.clients.flatMap(c=>(c.contacts||[]).map(full_name=>({id:this.uuid(),client_id:c.id,full_name,created_at:new Date().toISOString()}))); s.sequence=Math.max(0,...s.clients.map(c=>Number(c.client_no))); s.applications=clone(seed.applications).map(a=>({...a,currency:'EUR',version:1})); }); }
  data() { const s=this.repository.read(); return {...s,clients:s.clients.filter(c=>!c.deleted_at),applications:s.applications.filter(a=>!a.deleted_at && s.clients.some(c=>c.id===a.client_id&&!c.deleted_at))}; }
  listClients({query='',type='',status='',sort='client_no',direction='asc',page=0,limit=20}={}) {
    const s=this.data();
    const counts=new Map();
    for(const a of s.applications) counts.set(a.client_id,(counts.get(a.client_id)||0)+1);
    const searchable=s.clients.map(c=>({...c,
      application_count:counts.get(c.id)||0,
      contacts:s.contacts.filter(r=>r.client_id===c.id).flatMap(r=>[r.full_name,r.email,r.phone])
    }));
    const rows=D.searchClients(searchable,{query,type,status});
    const key=['client_no','legal_name','type','location','sectors','status','application_count'].includes(sort)?sort:'client_no';
    const value=c=>key==='type'?D.types[c.type]:key==='status'?D.statuses[c.status]:key==='sectors'?(c.sectors||[]).join(', '):c[key];
    rows.sort((a,b)=>(String(value(a)??'').localeCompare(String(value(b)??''),'uk',{numeric:true}) || a.client_no.localeCompare(b.client_no,'uk',{numeric:true}))*(direction==='desc'?-1:1));
    const size=Math.max(1,Math.min(100,Number.isInteger(limit)?limit:20));
    const index=Math.min(Math.max(0,Number.isInteger(page)?page:0),Math.max(0,Math.ceil(rows.length/size)-1));
    return {items:rows.slice(index*size,index*size+size),total:rows.length,page:index,limit:size};
  }
  saveClient(input,id,version) {
    const errors=D.validateClient(input); if(Object.keys(errors).length) throw Error(Object.values(errors).join(' '));
    return this.repository.transaction(s=>{
      const old=id ? s.clients.find(c=>c.id===id&&!c.deleted_at) : null;
      if(id && (!old || old.version!==version)) throw Error('Клієнта змінено або видалено. Оновіть сторінку.');
      const allowed=['legal_name','short_name','type','status','location','edrpou_optional','website','source','priority','description','next_action_at','sectors','geography','funding_needs','grants_experience','target_groups','prior_donors','capacity_note','competencies','portfolio','eligibility_notes'];
      const fields=Object.fromEntries(allowed.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
      const now=new Date().toISOString();
      const row={...old,...fields,id:old?.id||this.uuid(),client_no:old?.client_no||String(++s.sequence).padStart(4,'0'),version:(old?.version||0)+1,created_at:old?.created_at||now,updated_at:now};
      if(row.status==='archived' && old?.status!=='archived') row.previous_status=old?.status||'potential';
      if(old) Object.assign(old,row); else s.clients.push(row); return row;
    });
  }
  clientAction(id,action,confirmed=false) {
    return this.repository.transaction(s=>{ const c=s.clients.find(c=>c.id===id&&!c.deleted_at); if(!c) throw Error('Клієнта не знайдено.');
      if(action==='delete') { if(!confirmed) throw Error('Потрібне підтвердження видалення.'); c.deleted_at=new Date().toISOString(); }
      else if(action==='archive') { if(c.status!=='archived') {c.previous_status=c.status;c.status='archived';} }
      else if(action==='restore') c.status=c.previous_status||'potential';
      else throw Error('Невідома дія.'); c.version++; c.updated_at=new Date().toISOString();
    });
  }
  saveApplication(input,id,version) {
    validateApplication(input);
    return this.repository.transaction(s=>{ if(!s.clients.some(c=>c.id===input.client_id&&!c.deleted_at)) throw Error('Оберіть наявного клієнта.');
      const old=id?s.applications.find(a=>a.id===id&&!a.deleted_at):null;
      if(id&&(!old||old.version!==version)) throw Error('Заявку змінено або видалено. Оновіть сторінку.');
      const allowed=['client_id','title','grant','donor','deadline','amount','award_amount','currency','status','submission_at','donor_reply_at','notes'];
      const fields=Object.fromEntries(allowed.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
      const now=new Date().toISOString();const row={...old,...fields,id:old?.id||this.uuid(),application_no:old?.application_no||`ЛОК-${s.applications.length+1}`,version:(old?.version||0)+1,created_at:old?.created_at||now,updated_at:now};
      if(old) Object.assign(old,row);else s.applications.push(row);return row;
    });
  }
  applicationAction(id,action) {
    if(!['archive','restore'].includes(action))throw Error('Невідома дія.');
    return this.repository.transaction(s=>{const a=s.applications.find(a=>a.id===id&&!a.deleted_at);if(!a)throw Error('Заявку не знайдено.');a.archived_at=action==='archive'?new Date().toISOString():null;a.version++;a.updated_at=new Date().toISOString();});
  }
  deleteApplication(id,confirmed) { if(!confirmed) throw Error('Потрібне підтвердження.'); return this.repository.transaction(s=>{const a=s.applications.find(a=>a.id===id&&!a.deleted_at);if(!a)throw Error('Заявку не знайдено.');a.deleted_at=new Date().toISOString();a.version++;}); }
  addRelated(table,input) {
    if(!['contacts','interactions'].includes(table)) throw Error('Невідомий розділ.');
    if(table==='contacts' && (!input.full_name?.trim() || (input.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)))) throw Error('Вкажіть ім’я та коректну електронну адресу або залиште її порожньою.');
    if(table==='interactions' && (!input.summary?.trim()||!D.validDate(input.happened_at))) throw Error('Вкажіть підсумок та дату з часовим поясом.');
    return this.repository.transaction(s=>{if(!s.clients.some(c=>c.id===input.client_id&&!c.deleted_at)) throw Error('Клієнта не знайдено.'); const keys=table==='contacts'?['client_id','full_name','role','email','phone','preferred_channel']:['client_id','type','happened_at','summary','next_step']; const row={...Object.fromEntries(keys.map(k=>[k,input[k]||''])),id:this.uuid(),created_at:new Date().toISOString()};s[table].push(row);return row;});
  }
}
const api={LocalRepository,CrmService,statuses,validateApplication};if(typeof module!=='undefined')module.exports=api;else root.CrmCore=api;
})(globalThis);
