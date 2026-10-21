(function(root) {
'use strict';
const D = typeof module !== 'undefined' ? require('../shared/domain') : root.CrmDomain;
const clone = value => JSON.parse(JSON.stringify(value));
const statuses = { assessment:'Оцінювання', preparation:'У роботі', review:'Перевірка', submitted:'Подано · рішення очікується', rejected:'Відхилено', won:'Виграно', stopped:'Зупинено' };
const COLLECTIONS=['documents','partners','client_partners'];
const documentCategories={registration:'Установчі / реєстраційні',financial:'Фінансові',policy:'Політики',application:'Грантова заявка',contract:'Договір',memorandum:'Меморандум',support:'Лист підтримки',report:'Звіт',other:'Інше'};
const partnerTypes={ngo:'ГО',foundation:'БФ',government:'Державна установа',business:'Бізнес',international:'Міжнародна організація',expert:'Експерт',other:'Інше'};
const partnerStatuses={potential:'Потенційний',active:'Чинний',paused:'Призупинений',completed:'Завершений'};
const fields12={documents:['client_id','application_id','client_partner_id','title','category','url','document_date','expiry_at','note'],partners:['name','type','geography','sector','contacts','notes'],client_partners:['client_id','partner_id','role','status','start_date','comments','memorandum','memorandum_date','memorandum_expiry','memorandum_document_id','support_letter','support_date','support_document_id']};
function validate12(s) {
  if(s.modelVersion===undefined){if(COLLECTIONS.some(t=>Object.hasOwn(s,t)))throw Error('Некоректна версія каталогів.');return;}
  if(s.modelVersion!==12)throw Error('Невідома версія каталогів.');
  for(const table of COLLECTIONS) {
    if(!Array.isArray(s[table]) || new Set(s[table].map(r=>r.id)).size!==s[table].length)throw Error('Некоректний каталог.');
    for(const r of s[table]) {
      if(!r.id || !Number.isInteger(r.version)||r.version<1)throw Error('Некоректна версія каталогу.');
      for(const k of ['document_date','expiry_at','start_date','memorandum_date','memorandum_expiry','support_date'])if(r[k]&&!D.validDate(r[k]))throw Error('Вкажіть коректну дату.');
      if(table==='partners') {if(!r.name?.trim()||!Object.hasOwn(partnerTypes,r.type))throw Error('Вкажіть назву й тип партнера.');continue;}
      if(!s.clients.some(c=>c.id===r.client_id))throw Error('Порушено зв’язок клієнта.');
      if(table==='documents') {
        if(!r.title?.trim()||!Object.hasOwn(documentCategories,r.category))throw Error('Вкажіть назву й категорію документа.');
        D.driveUrl(r.url);
        if(r.application_id&&!s.applications.some(a=>a.id===r.application_id&&a.client_id===r.client_id))throw Error('Документ і заявка мають належати одному клієнту.');
        if(r.client_partner_id&&!s.client_partners.some(a=>a.id===r.client_partner_id&&a.client_id===r.client_id))throw Error('Порушено зв’язок документа з партнерством.');
      } else {
        if(!s.partners.some(p=>p.id===r.partner_id)||!Object.hasOwn(partnerStatuses,r.status))throw Error('Оберіть партнера та статус.');
        for(const key of ['memorandum','support_letter'])if(typeof r[key]!=='boolean')throw Error('Вкажіть наявність документа.');
        for(const [key,category] of [['memorandum_document_id','memorandum'],['support_document_id','support']])if(r[key]&&!s.documents.some(d=>d.id===r[key]&&d.client_id===r.client_id&&(!d.client_partner_id||d.client_partner_id===r.id)&&d.category===category))throw Error('Оберіть відповідний документ цього клієнта й партнерства.');
      }
    }
  }
  const pairs=s.client_partners.filter(r=>!r.deleted_at).map(r=>r.client_id+':'+r.partner_id);
  if(new Set(pairs).size!==pairs.length)throw Error('Цей партнер уже приєднаний до клієнта.');
}
const empty = () => ({version:2, modelVersion:12, documents:[], partners:[], client_partners:[], revision:0, sequence:0, clients:[], applications:[], contacts:[], interactions:[]});
class LocalRepository {
  constructor(storage = null) { this.storage = storage; this.key = 'crm-m2-synthetic-v2'; const raw = storage?.getItem(this.key); this.state = raw ? JSON.parse(raw) : empty(); if(this.state.modelVersion===undefined){validate12(this.state);Object.assign(this.state,{modelVersion:12,documents:[],partners:[],client_partners:[]});} this.validate(this.state); }
  validate(s) {
    if(s.version !== 2 || !Number.isInteger(s.revision) || !Number.isInteger(s.sequence)) throw Error('Некоректна версія сховища.');
    for(const table of ['clients','applications','contacts','interactions']) {
      if(!Array.isArray(s[table]) || new Set(s[table].map(r=>r.id)).size !== s[table].length || s[table].some(r=>!r.id)) throw Error('Некоректні записи сховища.');
    }
    if(new Set(s.clients.map(c=>c.client_no)).size !== s.clients.length || s.clients.some(c=>!/^\d+$/.test(c.client_no) || Number(c.client_no)>s.sequence || Object.keys(D.validateClient(c)).length)) throw Error('Некоректні клієнти.');
    for(const table of ['applications','contacts','interactions']) if(s[table].some(r=>!s.clients.some(c=>c.id===r.client_id))) throw Error('Порушено зв’язок із клієнтом.');
    for(const a of s.applications) validateApplication(a);
    validate12(s);
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
  restore(snapshot) { const next = JSON.parse(snapshot); this.validate(next); if(this.state.modelVersion===12&&next.modelVersion!==12)throw Error('Старий знімок не містить нових каталогів.'); return this.transaction(s=>{ const revision=s.revision; Object.assign(s,next,{revision,sequence:Math.max(s.sequence,next.sequence)}); }); }
}
function validateApplication(a) {
  if(!a.title?.trim() || !a.grant?.trim() || !a.donor?.trim() || !Object.hasOwn(statuses,a.status)) throw Error('Вкажіть назву заявки, грант, донора та статус.');
  if(!['EUR','UAH','USD','GBP'].includes(a.currency)) throw Error('Оберіть валюту.');
  for(const k of ['amount','award_amount']) if(a[k] != null && (typeof a[k] !== 'number' || !Number.isFinite(a[k]) || a[k]<0)) throw Error('Сума має бути невід’ємним числом.');
  if(a.official_url)D.normalizeUrl(a.official_url);
  for(const k of ['deadline','submission_at','donor_reply_at']) if(a[k] && !D.validDate(a[k])) throw Error('Вкажіть реальну календарну дату або ISO з часовим поясом.');
}
class CrmService {
  constructor(repository, uuid = D.uuid) { this.repository=repository; this.uuid=uuid; }
  initialize(seed) { if(this.repository.read().clients.length) return; this.repository.transaction(s=>{ s.clients=clone(seed.clients).map(c=>({...c,version:1})); s.contacts=seed.clients.flatMap(c=>(c.contacts||[]).map(full_name=>({id:this.uuid(),client_id:c.id,full_name,created_at:new Date().toISOString()}))); s.sequence=Math.max(0,...s.clients.map(c=>Number(c.client_no))); s.applications=clone(seed.applications).map(a=>({...a,currency:'EUR',version:1})); }); }
  data() { const s=this.repository.read(); return {...s,...Object.fromEntries(COLLECTIONS.map(t=>[t,(s[t]||[]).filter(r=>!r.deleted_at&&(t==='partners'||s.clients.some(c=>c.id===r.client_id&&!c.deleted_at)))])),clients:s.clients.filter(c=>!c.deleted_at),applications:s.applications.filter(a=>!a.deleted_at && s.clients.some(c=>c.id===a.client_id&&!c.deleted_at))}; }
  listClients({query='',type='',status='',sort='client_no',direction='asc',page=0,limit=20}={}) {
    const s=this.data();
    const summaries=D.applicationSummaries(s.applications);
    const searchable=s.clients.map(c=>({...c,
      social_links:c.social_links||[],organization_age:D.organizationAge(c),submitted_count:0,won_count:0,application_count:0,...summaries.get(c.id),
      contacts:s.contacts.filter(r=>r.client_id===c.id).flatMap(r=>[r.full_name,r.email,r.phone])
    }));
    const rows=D.searchClients(searchable,{query,type,status});
    const extra=['requested','awarded','next_deadline','last_application'];
    const key=['client_no','legal_name','edrpou_optional','type','location','sectors','status','application_count','nonprofit_code','organization_age','submitted_count','won_count','catalog_note',...extra].includes(sort)?sort:'client_no';
    const value=c=>key==='type'?D.types[c.type]:key==='status'?D.statuses[c.status]:key==='sectors'?(c.sectors||[]).join(', '):c[key];
    rows.sort((a,b)=>{
      const tie=a.client_no.localeCompare(b.client_no,'uk',{numeric:true});
      const sign=direction==='desc'?-1:1;
      if(['organization_age','submitted_count','won_count'].includes(key)) {
        if(a[key]==null || b[key]==null)return (a[key]==null)===(b[key]==null)?tie:a[key]==null?1:-1;
        return (a[key]-b[key])*sign || tie;
      }
      if(extra.includes(key))return D.compareSummary(a,b,key,direction)||tie;
      return (String(value(a)??'').localeCompare(String(value(b)??''),'uk',{numeric:true})||tie)*sign;
    });
    const size=Math.max(1,Math.min(100,Number.isInteger(limit)?limit:20));
    const index=Math.min(Math.max(0,Number.isInteger(page)?page:0),Math.max(0,Math.ceil(rows.length/size)-1));
    return {items:rows.slice(index*size,index*size+size),total:rows.length,page:index,limit:size};
  }
  saveClient(input,id,version) {
    const errors=D.validateClient(input); if(Object.keys(errors).length) throw Error(Object.values(errors).join(' '));
    return this.repository.transaction(s=>{
      const old=id ? s.clients.find(c=>c.id===id&&!c.deleted_at) : null;
      if(id && (!old || old.version!==version)) throw Error('Клієнта змінено або видалено. Оновіть сторінку.');
      const allowed=['social_links','nonprofit_code','registration_date','catalog_note','legal_name','short_name','type','status','location','edrpou_optional','website','source','priority','description','next_action_at','sectors','geography','funding_needs','grants_experience','target_groups','prior_donors','capacity_note','competencies','portfolio','eligibility_notes'];
      const fields=Object.fromEntries(allowed.filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
      if(fields.social_links)fields.social_links=fields.social_links.map(link=>({platform:link.platform,url:D.normalizeUrl(link.url),label:link.label||''}));
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
      const allowed=['official_url','client_id','title','grant','donor','deadline','amount','award_amount','currency','status','submission_at','donor_reply_at','notes'];
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
  saveContact(input,id,version) {
    if(!input.full_name?.trim() || (input.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email))) throw Error('Вкажіть ім’я та коректну електронну адресу.');
    return this.repository.transaction(s=>{
      const row=s.contacts.find(r=>r.id===id&&r.client_id===input.client_id);
      if(!row || (row.version||1)!==version || !s.clients.some(c=>c.id===row.client_id&&!c.deleted_at)) throw Error('Контакт змінено або видалено. Оновіть сторінку.');
      for(const key of ['full_name','role','email','phone','preferred_channel']) if(Object.hasOwn(input,key)) row[key]=input[key];
      row.version=(row.version||1)+1;row.updated_at=new Date().toISOString();return row;
    });
  }
  saveCatalog(table,input,id,version) {
    if(!COLLECTIONS.includes(table))throw Error('Невідомий каталог.');
    return this.repository.transaction(s=>{
      if(s.modelVersion!==12)throw Error('CRM12_MIGRATION_REQUIRED');
      const old=id?s[table].find(r=>r.id===id&&!r.deleted_at):null;
      if(id&&(!old||old.version!==version))throw Error('Запис змінено або видалено.');
      const fields=Object.fromEntries(fields12[table].filter(k=>Object.hasOwn(input,k)).map(k=>[k,input[k]]));
      const row={...old,...fields,id:old?.id||this.uuid(),version:(old?.version||0)+1,created_at:old?.created_at||new Date().toISOString(),updated_at:new Date().toISOString()};
      if(table!=='partners'&&!s.clients.some(c=>c.id===row.client_id&&!c.deleted_at))throw Error('Клієнта видалено.');
      if(old&&table!=='partners'&&old.client_id!==row.client_id)throw Error('Не можна переносити запис до іншого клієнта.');
      if(table==='partners'&&s.partners.some(p=>p.id!==id&&!p.deleted_at&&p.name.trim().toLocaleLowerCase('uk')===row.name?.trim().toLocaleLowerCase('uk')))throw Error('Партнер із такою назвою вже є. Оберіть його з довідника.');
      if(table==='documents') {
        row.url=D.driveUrl(row.url);
        for(const [key,collection] of [['application_id','applications'],['client_partner_id','client_partners']])if(row[key]&&!s[collection].some(r=>r.id===row[key]&&(!r.deleted_at||old?.[key]===row[key])&&r.client_id===row.client_id))throw Error('Пов’язаний запис видалено або належить іншому клієнту.');
      }
      if(table==='client_partners') {
        if(old&&old.partner_id!==row.partner_id)throw Error('Не можна замінити партнера в наявному зв’язку.');
        for(const k of ['memorandum_document_id','support_document_id'])if(row[k]&&!s.documents.some(d=>d.id===row[k]&&(!d.deleted_at||old?.[k]===row[k])))throw Error('Документ вилучено з каталогу.');
      }
      if(old)Object.assign(old,row);else s[table].push(row);
      validate12(s);return row;
    });
  }
  removeCatalog(table,id,version,confirmed) {
    if(!['documents','client_partners'].includes(table)||confirmed!==true)throw Error('Підтвердіть вилучення з каталогу.');
    return this.repository.transaction(s=>{
      if(s.modelVersion!==12)throw Error('CRM12_MIGRATION_REQUIRED');
      const row=s[table].find(r=>r.id===id&&!r.deleted_at);
      if(!row||row.version!==version||!s.clients.some(c=>c.id===row.client_id&&!c.deleted_at))throw Error('Запис змінено або видалено.');
      row.deleted_at=new Date().toISOString();row.updated_at=row.deleted_at;row.version++;return row;
    });
  }
  addRelated(table,input) {
    if(!['contacts','interactions'].includes(table)) throw Error('Невідомий розділ.');
    if(table==='contacts' && (!input.full_name?.trim() || (input.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)))) throw Error('Вкажіть ім’я та коректну електронну адресу або залиште її порожньою.');
    if(table==='interactions' && (!input.summary?.trim()||(input.happened_at&&!D.validDate(input.happened_at)))) throw Error('Вкажіть підсумок та коректну дату.');
    return this.repository.transaction(s=>{if(!s.clients.some(c=>c.id===input.client_id&&!c.deleted_at)) throw Error('Клієнта не знайдено.'); const keys=table==='contacts'?['client_id','full_name','role','email','phone','preferred_channel']:['client_id','type','happened_at','summary','next_step']; const row={...Object.fromEntries(keys.map(k=>[k,input[k]||''])),id:this.uuid(),created_at:new Date().toISOString()};s[table].push(row);return row;});
  }
}
const api={COLLECTIONS,documentCategories,partnerTypes,partnerStatuses,validate12,LocalRepository,CrmService,statuses,validateApplication};if(typeof module!=='undefined')module.exports=api;else root.CrmCore=api;
})(globalThis);
