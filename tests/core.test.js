const {test}=require('node:test');
const assert=require('node:assert/strict');
const {LocalRepository,CrmService}=require('../source/server/core');
const registry=require('../source/shared/registry');
const client={legal_name:'Демо: Тестова організація',type:'ngo',status:'active',sectors:['Освіта']};
const application={title:'Демо: Заявка',grant:'Демо: Конкурс',donor:'Демо: Донор',status:'preparation',amount:null,currency:'EUR'};
const setup=()=>{const repository=new LocalRepository();return {repository,service:new CrmService(repository)};};
test('CRUD клієнта: UUID, незмінний номер, архів, відновлення, м’яке видалення',()=>{
 const {service:s,repository:r}=setup(); const c=s.saveClient(client);
 assert.match(c.id,/^[0-9a-f-]{36}$/);assert.equal(c.client_no,'0001');
 const updated=s.saveClient({...client,legal_name:'Демо: Оновлено',id:'fake',client_no:'9999'},c.id,c.version);
 assert.equal(updated.id,c.id);assert.equal(updated.client_no,'0001');
 s.clientAction(c.id,'archive');s.clientAction(c.id,'archive');s.clientAction(c.id,'restore');assert.equal(s.data().clients[0].status,'active');
 assert.throws(()=>s.clientAction(c.id,'delete'),/підтвердження/);s.clientAction(c.id,'delete',true);assert.equal(s.data().clients.length,0);assert.ok(r.read().clients[0].deleted_at);assert.equal(s.saveClient(client).client_no,'0002');
});
test('Клієнт: невалідні дані та застаріла версія не перезаписують запис',()=>{const {service:s}=setup();assert.throws(()=>s.saveClient({...client,legal_name:''}));const c=s.saveClient(client);s.saveClient({...client,legal_name:'Демо: Зміна'},c.id,c.version);assert.throws(()=>s.saveClient(client,c.id,c.version),/змінено/);assert.equal(s.data().clients[0].legal_name,'Демо: Зміна');});
test('Заявки: створення, зміна всіх бізнес-полів, зв’язки, статус, видалення',()=>{const {service:s}=setup();const c=s.saveClient(client),other=s.saveClient({...client,legal_name:'Демо: Інший'});const a=s.saveApplication({...application,client_id:c.id});const b=s.saveApplication({...application,client_id:other.id,title:'Демо: Оновлена',grant:'Демо: Інший конкурс',donor:'Демо: Інший донор',status:'submitted',amount:500,award_amount:100,currency:'UAH',deadline:'2026-10-28T18:00:00+02:00',submission_at:'2026-10-12T10:00:00Z',donor_reply_at:'2026-10-30T10:00:00Z',notes:'Вигаданий результат'},a.id,a.version);assert.equal(b.id,a.id);assert.equal(b.client_id,other.id);assert.equal(b.status,'submitted');assert.equal(b.currency,'UAH');assert.equal(b.amount,500);assert.throws(()=>s.saveApplication(application,a.id,a.version));assert.throws(()=>s.deleteApplication(a.id,false));s.deleteApplication(a.id,true);assert.equal(s.data().applications.length,0);});
test('Неіснуючі та видалені клієнти не приймають заявки; видалення приховує залежні заявки',()=>{const {service:s,repository:r}=setup();assert.throws(()=>s.saveApplication({...application,client_id:'missing'}));const c=s.saveClient(client);s.saveApplication({...application,client_id:c.id});s.clientAction(c.id,'delete',true);assert.equal(s.data().applications.length,0);assert.equal(r.read().applications.length,1);assert.throws(()=>s.saveApplication({...application,client_id:c.id}));});
test('Суми й дати: невідоме не стає нулем; від’ємні суми й час без поясу відхилено',()=>{const {service:s}=setup();const c=s.saveClient(client);for(const fields of [{amount:-1},{amount:Infinity},{deadline:'2026-02-30T10:00:00Z'},{submission_at:'2026-10-10T10:00:00'},{currency:'BAD'},{status:'unknown'}])assert.throws(()=>s.saveApplication({...application,client_id:c.id,...fields}));assert.equal(s.saveApplication({...application,client_id:c.id}).amount,null);});
test('Досьє: кілька контактів і незмінний журнал взаємодій',()=>{const {service:s}=setup();const c=s.saveClient(client);s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Контакт',email:'demo@example.invalid'});s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Другий'});s.addRelated('interactions',{client_id:c.id,type:'Дзвінок',summary:'Синтетична розмова',happened_at:'2026-10-12T12:00:00+03:00'});assert.equal(s.data().contacts.length,2);assert.equal(s.data().interactions.length,1);assert.throws(()=>s.addRelated('contacts',{client_id:'missing',full_name:'Демо'}));assert.throws(()=>s.addRelated('contacts',{client_id:c.id,full_name:'Демо',email:'invalid'}));});
test('Помилка квоти залишає сховище та лічильник без змін',()=>{const storage={getItem:()=>null,setItem:()=>{throw Error('quota');}};const r=new LocalRepository(storage),s=new CrmService(r);assert.throws(()=>s.saveClient(client),/Не вдалося/);assert.equal(r.read().sequence,0);assert.equal(s.data().clients.length,0);});
test('Повторне відкриття зберігає зміни; конфлікт вкладок відхиляється',()=>{let raw=null;const storage={getItem:()=>raw,setItem:(k,v)=>{raw=v;}};const r1=new LocalRepository(storage),r2=new LocalRepository(storage);new CrmService(r1).saveClient(client);assert.throws(()=>new CrmService(r2).saveClient(client),/іншій вкладці/);assert.equal(new CrmService(new LocalRepository(storage)).data().clients.length,1);});
test('Знімок відновлює зв’язки; пошкоджений знімок не знищує стан і номери не повторюються',()=>{const {service:s,repository:r}=setup();const c=s.saveClient(client);s.saveApplication({...application,client_id:c.id});const backup=r.snapshot();s.saveClient(client);r.restore(backup);assert.equal(s.data().applications[0].client_id,c.id);assert.equal(s.saveClient(client).client_no,'0003');const broken=JSON.parse(backup);broken.applications[0].client_id='missing';const before=r.snapshot();assert.throws(()=>r.restore(JSON.stringify(broken)));assert.equal(r.snapshot(),before);});
test('Повторна ініціалізація не повертає видалені записи й не дублює дані',()=>{const {service:s}=setup();const seed={clients:[{...client,id:'demo-id',client_no:'0001',contacts:['Демо контакт']}],applications:[]};s.initialize(seed);s.clientAction('demo-id','delete',true);s.initialize(seed);assert.equal(s.data().clients.length,0);assert.equal(s.data().contacts.length,1);});
test('Сортування сум групує валюти без хибної конвертації',()=>{const rows=[{id:'1',amount:100,currency:'UAH'},{id:'2',amount:500,currency:'EUR'},{id:'3',amount:10,currency:'EUR'}];assert.deepEqual(registry.select(rows,[],{sort:'amount'}).map(a=>a.id),['3','2','1']);});
test('Сервіс каталогу: пошук контактів, комбіновані фільтри, сортування, пагінація',()=>{const {service:s}=setup();for(let i=0;i<25;i++)s.saveClient({...client,legal_name:`Демо: Клієнт ${i}`});const c=s.data().clients[0];s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Координатор'});assert.equal(s.listClients({query:'Координатор',type:'ngo',status:'active'}).total,1);assert.equal(s.listClients().items.length,20);assert.equal(s.listClients({page:1}).items.length,5);assert.equal(s.listClients({direction:'desc'}).items[0].client_no,'0025');assert.equal(s.listClients({query:'Відсутній'}).total,0);});

test('Каталог: сім колонок сортуються, лічильник враховує архів і не враховує видалені заявки',()=>{
 const {service:s}=setup();const a=s.saveClient({...client,legal_name:'Демо: А',location:'Київ',geography:'Синтетичний регіон'}),b=s.saveClient({...client,legal_name:'Демо: Б',type:'company',status:'paused',location:'Львів',sectors:['Медицина']});
 const app=s.saveApplication({...application,client_id:a.id});s.applicationAction(app.id,'archive');
 const deleted=s.saveApplication({...application,client_id:a.id});s.deleteApplication(deleted.id,true);
 const before=s.repository.snapshot();
 assert.equal(s.listClients({sort:'application_count',direction:'desc'}).items[0].application_count,1);
 assert.equal(s.listClients({sort:'application_count'}).items[0].id,b.id);
 assert.equal(s.listClients({query:'Синтетичний регіон'}).items[0].id,a.id);
 assert.equal(s.listClients({query:a.client_no}).total,1);
 for(const sort of ['client_no','legal_name','type','location','sectors','status','application_count'])assert.deepEqual(s.listClients({sort}).items.map(c=>c.id),s.listClients({sort,direction:'desc'}).items.map(c=>c.id).reverse());
 assert.deepEqual(s.listClients().items[0].sectors,['Освіта']);assert.equal(s.repository.snapshot(),before);
});

test('Часткове редагування вкладок зберігає досьє старих записів, контакти та заявки',()=>{
 const {service:s,repository:r}=setup();const c=s.saveClient({...client,geography:'Демо: регіон',capacity_note:'Демо: команда',competencies:'Демо: компетенції',description:'Демо: опис'});
 s.addRelated('contacts',{client_id:c.id,full_name:'Демо: Людина'});s.saveApplication({...application,client_id:c.id});
 const updated=s.saveClient({legal_name:'Демо: Нова назва',type:c.type,status:c.status,location:'Демо: місто',sectors:[]},c.id,c.version);
 assert.equal(updated.capacity_note,c.capacity_note);assert.equal(updated.geography,c.geography);assert.equal(updated.competencies,c.competencies);
 const dossier=s.saveClient({legal_name:updated.legal_name,type:updated.type,status:updated.status,capacity_note:''},c.id,updated.version);
 assert.equal(dossier.capacity_note,'');assert.equal(dossier.location,'Демо: місто');assert.equal(dossier.description,c.description);
 const snapshot=r.snapshot();const restored=new LocalRepository();restored.restore(snapshot);assert.equal(new CrmService(restored).data().contacts.length,1);assert.equal(new CrmService(restored).data().applications.length,1);
});
