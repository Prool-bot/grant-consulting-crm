(function(root) {
'use strict';
const Core = typeof module !== 'undefined' ? require('../server/core') : root.CrmCore;
const Domain = typeof module !== 'undefined' ? require('../shared/domain') : root.CrmDomain;
const copy = value => JSON.parse(JSON.stringify(value));
const TABLES = ['clients','client_profiles','contacts','interactions','grants','applications'];
const tablesFor = state => state.modelVersion===12 ? [...TABLES,...Core.COLLECTIONS] : TABLES;
const HEADER = ['id','client_id','version','data_json'];
const PROFILE = ['sectors','geography','funding_needs','grants_experience','target_groups','prior_donors','capacity_note','competencies','portfolio','eligibility_notes'];
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const empty = () => ({version:2,revision:0,sequence:0,clients:[],applications:[],contacts:[],interactions:[],receipts:[]});
function validate(state) {
  new Core.LocalRepository().validate(state);
  if(!Number.isSafeInteger(state.revision) || !Number.isSafeInteger(state.sequence) || state.revision < 0 || state.sequence < 0 || !Array.isArray(state.receipts)) throw Error('Пошкоджено метадані бази.');
  for(const table of ['clients','applications','contacts','interactions',...(state.modelVersion===12?Core.COLLECTIONS:[])]) {
    for(const row of state[table]) {
      if(!UUID.test(row.id) || !Number.isInteger(row.version) || row.version < 1) throw Error('Некоректний UUID або версія запису.');
      if(table==='contacts' && (!row.full_name?.trim() || (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)))) throw Error('Некоректний контакт.');
      if(table==='interactions' && (!row.summary?.trim() || (row.happened_at && !Domain.validDate(row.happened_at)))) throw Error('Некоректна взаємодія.');
      if(row.contact_id && !state.contacts.some(c=>c.id===row.contact_id && c.client_id===row.client_id)) throw Error('Порушено зв’язок контакту.');
    }
  }
  if(new Set(state.receipts.map(r=>r.id)).size!==state.receipts.length || state.receipts.some(r=>!UUID.test(r.id)||typeof r.fingerprint!=='string')) throw Error('Пошкоджено журнал повторів.');
}
function normalize(state) {
  const tables = Object.fromEntries(tablesFor(state).map(t=>[t,[]]));
  for(const original of state.clients) {
    const client=copy(original), profile={id:client.id,client_id:client.id,version:client.version};
    for(const key of PROFILE) if(Object.hasOwn(client,key)) { profile[key]=client[key];delete client[key]; }
    tables.clients.push(client);tables.client_profiles.push(profile);
  }
  for(const original of state.applications) {
    const app=copy(original);
    // Один грантовий запис на заявку: однакові назви не об’єднують різні конкурси.
    tables.grants.push({id:app.id,version:app.version,title:app.grant,donor:app.donor,deadline_at:app.deadline||''});
    app.grant_id=app.id;app.requested_amount=app.amount??null;
    delete app.grant;delete app.donor;delete app.deadline;delete app.amount;
    tables.applications.push(app);
  }
  tables.contacts=copy(state.contacts);tables.interactions=copy(state.interactions);
  if(state.modelVersion===12)for(const table of Core.COLLECTIONS)tables[table]=copy(state[table]);
  return tables;
}
class SheetsRepository {
  constructor({spreadsheet,lock,flush,hash,expectedRevision=null,request=null,diagnostics=null}) {
    Object.assign(this,{spreadsheet,lock,hash,expectedRevision,request});
    this.diagnostics=diagnostics?.enabled===true?diagnostics:null;
    this.flush=()=>this.measure('flush',flush);
  }
  measure(stage,action) {
    if(!this.diagnostics || !this.timings)return action();
    const clock=()=>{try{const value=(this.diagnostics.clock||Date.now)();return Number.isFinite(value)?value:0;}catch{return 0;}};
    const frame={start:clock(),children:0};this.frames.push(frame);let ok=false;
    try{const result=action();ok=true;return result;}finally{
      const ms=Math.max(0,clock()-frame.start);this.frames.pop();
      if(this.frames.length)this.frames[this.frames.length-1].children+=ms;
      const row=this.timings[stage]||(this.timings[stage]={calls:0,durationMs:0,selfMs:0,failures:0});
      row.calls++;row.durationMs+=ms;row.selfMs+=Math.max(0,ms-frame.children);if(!ok)row.failures++;
    }
  }
  locked(action) {
    if(this.diagnostics){this.timings={};this.frames=[];}
    try{return this.measure('repository_total',()=>{
      this.measure('lock_wait',()=>{if(!this.lock.tryLock(10000))throw Error('База зайнята. Повторіть запит із тим самим ідентифікатором.');});
      try{return action();}finally{this.lock.releaseLock();}
    });}finally{
      // Один обмежений звіт після звільнення lock. Збій діагностики не впливає на дані.
      if(this.diagnostics){
        const stages={};
        for(const key of ['repository_total','lock_wait','control_read','journal_read','checksum','state_validate','sheets_verify','journal_write','sheets_update','flush'])if(this.timings[key])stages[key]={...this.timings[key]};
        this.timings=null;
        try{this.diagnostics.emit({kind:'crm_repository_timing',version:1,stages});}catch{}
      }
    }
  }
  sheet(name) { const sheet=this.spreadsheet.getSheetByName(name);if(!sheet)throw Error('Базу не налаштовано.');return sheet; }
  cell(name) { return this.sheet(name).getRange(2,1); }
  control() {
    const raw=this.cell('_crm_control').getValue();
    if(!raw) return {schema:1,committed:null,pending:null};
    const value=JSON.parse(raw);
    if(![1,2].includes(value.schema) || !Object.hasOwn(value,'committed') || !Object.hasOwn(value,'pending'))throw Error('Невідома схема бази.');
    return value;
  }
  setup() {
    return this.locked(()=>{
      const headers={...Object.fromEntries(TABLES.map(t=>[t,HEADER])),_crm_control:['control_json'],_crm_journal:['chunk']};
      // Спершу перевіряємо всі наявні заголовки, не перезаписуємо сторонні дані.
      for(const [name,header] of Object.entries(headers)) {
        const sheet=this.spreadsheet.getSheetByName(name);
        if(sheet && sheet.getLastRow()>0 && JSON.stringify(sheet.getRange(1,1,1,header.length).getValues()[0])!==JSON.stringify(header)) throw Error('Несумісна структура аркушів. Потрібна окрема порожня база.');
      }
      for(const [name,header] of Object.entries(headers)) {
        const sheet=this.spreadsheet.getSheetByName(name)||this.spreadsheet.insertSheet(name);
        if(!sheet.getLastRow()) sheet.getRange(1,1,1,header.length).setValues([header]);
      }
      this.flush();
      const control=this.control();
      if(!control.committed&&!control.pending) {
        if(TABLES.some(t=>this.sheet(t).getLastRow()>1)) throw Error('Немає метаданих для наявних записів. Автоматичне очищення заборонено.');
        // Без покажчика дозволені лише осиротілі початкові знімки після збою setup.
        const journal=this.sheet('_crm_journal'), count=journal.getLastRow()-1;
        if(count && journal.getRange(2,1,count,1).getValues().some(([value])=>value!=='j:'+JSON.stringify(empty())))throw Error('Втрачено метадані журналу. Автоматичне очищення заборонено.');
        this.commit(empty(),control);
      } else this.recover(control);
      return {schema:this.control().schema,tables:tablesFor(this.recover()).slice()};
    });
  }
  writeControl(control) { this.cell('_crm_control').setValue(JSON.stringify(control));this.flush(); }
  journal(pointer) {
    if(!pointer || !Number.isInteger(pointer.start)||pointer.start<2||!Number.isInteger(pointer.count)||pointer.count<1||pointer.count>10000) throw Error('Пошкоджено покажчик журналу.');
    const chunks=this.sheet('_crm_journal').getRange(pointer.start,1,pointer.count,1).getValues();
    if(chunks.some(([v])=>typeof v!=='string'||!v.startsWith('j:')))throw Error('Пошкоджено журнал відновлення.');
    const raw=chunks.map(([v])=>v.slice(2)).join('');
    if(this.measure('checksum',()=>this.hash(raw))!==pointer.hash)throw Error('Контрольна сума журналу не збігається.');
    const state=JSON.parse(raw);this.measure('state_validate',()=>validate(state));return state;
  }
  project(state,previousState=null) {
    // Попередній стан перевірено під тим самим lock; відновлення завжди проєктує всі аркуші.
    const tables=normalize(state), previousTables=previousState?normalize(previousState):null;
    for(const name of tablesFor(state)) {
      if(previousTables && JSON.stringify(tables[name])===JSON.stringify(previousTables[name]))continue;
      const sheet=this.sheet(name), rows=tables[name].map(r=>[r.id,r.client_id||'',r.version,JSON.stringify(r)]);
      if(rows.some(r=>r[3].length>45000))throw Error('Запис перевищує безпечний розмір комірки.');
      const previous=sheet.getLastRow()-1;
      if(rows.length+1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),rows.length+1-sheet.getMaxRows());
      if(rows.length) sheet.getRange(2,1,rows.length,HEADER.length).setValues(rows);
      if(previous>rows.length)sheet.getRange(rows.length+2,1,previous-rows.length,HEADER.length).clearContent();
    }
    this.flush();
  }
  recover(control=this.control()) {
    if(control.pending) {
      const next=this.journal(control.pending);
      this.project(next);
      this.writeControl({schema:next.modelVersion===12?2:1,committed:control.pending,pending:null});
      return next;
    }
    if(!control.committed)throw Error('Базу не налаштовано.');
    const state=this.journal(control.committed);
    this.verifyProjection(state);return state;
  }
  verifyProjection(state) {
    // Між викликами немає кешу: зміни поза CRM перевіряються щоразу.
    // Ручне редагування Sheets не є API CRM: відмовляємо, не стираючи змін власника.
    const expected=normalize(state);
    for(const name of tablesFor(state)) {
      const sheet=this.sheet(name), count=sheet.getLastRow()-1;
      const values=sheet.getRange(1,1,Math.max(1,count+1),HEADER.length).getValues();
      if(JSON.stringify(values[0])!==JSON.stringify(HEADER))throw Error('Несумісна структура аркушів.');
      const rows=values.slice(1);
      const wanted=expected[name].map(r=>[r.id,r.client_id||'',r.version,JSON.stringify(r)]);
      if(JSON.stringify(rows)!==JSON.stringify(wanted))throw Error('Аркуші змінено поза CRM. Збережіть приватну копію та виконайте перевірене відновлення.');
    }
  }
  commit(next,control,previousState=null) {
    this.measure('state_validate',()=>validate(next));
    // Обмеження перевіряються ДО публікації pending, щоб відновлення завжди могло завершитися.
    for(const rows of Object.values(normalize(next))) if(rows.some(r=>JSON.stringify(r).length>45000))throw Error('Запис перевищує безпечний розмір комірки.');
    const raw=JSON.stringify(next);
    if(raw.length>2000000)throw Error('Перевищено ліміт розміру бази М2.5. Потрібне погоджене розширення адаптера.');
    const chunks=raw.match(/[\s\S]{1,15000}/gu).map(v=>['j:'+v]);
    const start=this.measure('journal_write',()=>{
    const sheet=this.sheet('_crm_journal'), start=sheet.getLastRow()+1;
    if(start+chunks.length>100000)throw Error('Журнал заповнено. Потрібне погоджене обслуговування та резервна копія.');
    if(start+chunks.length-1>sheet.getMaxRows())sheet.insertRowsAfter(sheet.getMaxRows(),start+chunks.length-1-sheet.getMaxRows());
    sheet.getRange(start,1,chunks.length,1).setValues(chunks);
    return start;
    });this.flush();
    const pending={start,count:chunks.length,hash:this.measure('checksum',()=>this.hash(raw))};
    // Журнал не очищається: попередня підтверджена версія залишається доступною.
    this.journal(pending);
    this.writeControl({schema:next.modelVersion===12?2:1,committed:control.committed,pending});
    this.project(next,previousState);
    this.writeControl({schema:next.modelVersion===12?2:1,committed:pending,pending:null});
  }
  read() { return this.locked(()=>copy(this.recover())); }
  transaction(change,sync=false) {
    return this.locked(()=>{
      const current=this.recover(), request=this.request;
      if(request) {
        if(!UUID.test(request.id)||typeof request.fingerprint!=='string')throw Error('Потрібен UUID запиту.');
        const receipt=current.receipts.find(r=>r.id===request.id);
        if(receipt) {if(receipt.fingerprint!==request.fingerprint)throw Error('Ідентифікатор запиту вже використано для іншої дії.');return sync?{protocol:1,result:copy(receipt.result),sync:{state:Core.wireState(current)}}:copy(receipt.result);}
      }
      if(this.expectedRevision!==null && current.revision!==this.expectedRevision)throw Error('Конфлікт ревізії. Оновіть дані перед новою зміною.');
      const next=copy(current), result=copy(change(next)??null);
      next.revision=current.revision+1;
      // М2 не версіонував незмінні додані контакти та взаємодії.
      for(const table of ['contacts','interactions'])for(const row of next[table])if(!row.version)row.version=1;
      if(request)next.receipts.push({id:request.id,fingerprint:request.fingerprint,result});
      const response=sync?{protocol:1,result,sync:Core.changesSince(current,next)}:result;
      this.commit(next,this.control(),current);return response;
    });
  }
  snapshot() { return JSON.stringify(this.read()); }
  repairProjection(expectedRevision,confirmed=false) {
    if(confirmed!==true)throw Error('Спочатку збережіть приватну копію ручних змін і підтвердьте відновлення.');
    return this.locked(()=>{
      const control=this.control();
      if(control.pending)throw Error('Спочатку завершіть очікувану операцію повторним читанням.');
      const state=this.journal(control.committed);
      if(state.revision!==expectedRevision)throw Error('Конфлікт ревізії.');
      for(const name of tablesFor(state))if(JSON.stringify(this.sheet(name).getRange(1,1,1,HEADER.length).getValues()[0])!==JSON.stringify(HEADER))throw Error('Несумісна структура аркушів.');
      this.project(state);
      return {revision:state.revision};
    });
  }
  migrate12(expectedRevision,backupConfirmed=false) {
    if(backupConfirmed!==true||!Number.isSafeInteger(expectedRevision))throw Error('Потрібні ревізія та підтвердження незалежної приватної копії.');
    return this.locked(()=>{
      const state=this.recover(),control=this.control();
      if(state.modelVersion===12) {
        if(state.migration12?.fromRevision!==expectedRevision)throw Error('Конфлікт ревізії міграції.');
        return {revision:state.revision,migrated:true};
      }
      if(state.revision!==expectedRevision)throw Error('Конфлікт ревізії. Створіть свіжу резервну копію.');
      // Підтверджений старий знімок залишається в журналі; зовнішню копію створює власник.
      for(const name of Core.COLLECTIONS) {
        const sheet=this.spreadsheet.getSheetByName(name);
        if(sheet&&(sheet.getLastRow()>1 || (sheet.getLastRow()&&JSON.stringify(sheet.getRange(1,1,1,HEADER.length).getValues()[0])!==JSON.stringify(HEADER))))throw Error('Несумісна структура нових каталогів.');
      }
      for(const name of Core.COLLECTIONS) {
        const sheet=this.spreadsheet.getSheetByName(name)||this.spreadsheet.insertSheet(name);
        if(!sheet.getLastRow())sheet.getRange(1,1,1,HEADER.length).setValues([HEADER]);
      }
      this.flush();
      const next={...copy(state),modelVersion:12,documents:[],partners:[],client_partners:[],revision:state.revision+1,migration12:{fromRevision:state.revision,backup:control.committed}};
      this.commit(next,control);
      this.recover();return {revision:next.revision,migrated:true};
    });
  }
  restore(snapshot) {
    const restored=JSON.parse(snapshot);validate(restored);
    return this.transaction(state=>{
      if(state.modelVersion!==12&&restored.modelVersion===12)throw Error('CRM12_MIGRATION_REQUIRED');
      if(state.modelVersion===12&&restored.modelVersion!==12)throw Error('Старий знімок не містить каталогів CRM 1.2. Відновлюйте його в окремій базі.');
      const {revision,sequence,receipts}=state;
      // Старі форми не повинні збігтися з версіями після відновлення.
      for(const table of ['clients','applications','contacts','interactions',...(restored.modelVersion===12?Core.COLLECTIONS:[])])for(const row of restored[table])row.version=Math.max(row.version,state[table].find(r=>r.id===row.id)?.version||0)+1;
      Object.assign(state,restored,{revision,sequence:Math.max(sequence,restored.sequence),receipts});
    });
  }
}
// Назви етапів фіксовані: аргументи, результати й помилки ніколи не потрапляють у звіт.
for(const [method,stage] of [['control','control_read'],['journal','journal_read'],['verifyProjection','sheets_verify'],['project','sheets_update']]) {
  const original=SheetsRepository.prototype[method];
  SheetsRepository.prototype[method]=function(...args){return this.measure(stage,()=>original.apply(this,args));};
}
const api={SheetsRepository,normalize,validate,TABLES};
if(typeof module!=='undefined')module.exports=api;else root.CrmSheets=api;
})(globalThis);
