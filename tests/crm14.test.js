'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {CrmService,LocalRepository,statuses}=require('../source/server/core');
const D=require('../source/shared/domain');

const client={legal_name:'ГО «Тестовий клієнт»',type:'ngo',status:'active'};
const application={title:'Тестова грантова заявка',grant:'Конкурс',donor:'Донор',status:'won',currency:'UAH',amount:12500.50};

test('CRM 1.4: нова назва отриманих грантів без зміни коду статусу',()=>{
 assert.equal(statuses.won,'Отримано');
 const service=new CrmService(new LocalRepository());
 const c=service.saveClient(client);
 service.saveApplication({...application,client_id:c.id});
 assert.equal(service.listClients().items[0].won_count,1);
});
test('CRM 1.4: соті в сумах зберігаються й не зникають після перезавантаження',()=>{
 const repo=new LocalRepository(),service=new CrmService(repo),c=service.saveClient(client);
 const a=service.saveApplication({...application,client_id:c.id,award_amount:4000.25});
 assert.equal(a.amount,12500.5);assert.equal(a.award_amount,4000.25);
 const next=new CrmService(repo).data().applications[0];
 assert.equal(next.amount,12500.5);assert.equal(next.award_amount,4000.25);
});
test('CRM 1.4: сервер відхиляє дробові копійки та небезпечну точність суми',()=>{
 const repo=new LocalRepository(),service=new CrmService(repo),c=service.saveClient(client);
 for(const field of ['amount','award_amount']){
  assert.throws(()=>service.saveApplication({...application,client_id:c.id,[field]:12.345}),/двох десяткових/);
 }
 assert.throws(()=>service.saveApplication({...application,client_id:c.id,amount:Number.MAX_SAFE_INTEGER}),/двох десяткових/);
 const saved=service.saveApplication({...application,client_id:c.id,amount:12500.50,award_amount:0.01});
 assert.equal(saved.award_amount,0.01);
 // До CRM 1.4 могли потрапити суми з понад двома знаками; інші операції не блокуються.
 repo.transaction(s=>{s.applications[0].amount=12.345;});
 service.saveClient({...client,short_name:'Синтетична ГО'},c.id,c.version);
 assert.equal(repo.read().applications[0].amount,12.345);
});
test('CRM 1.4: дати проєкту перевіряються і зберігаються без зміни схеми',()=>{
 const repo=new LocalRepository(),service=new CrmService(repo),c=service.saveClient(client);
 const a=service.saveApplication({...application,client_id:c.id,project_start_date:'2026-11-01',project_end_date:'2027-02-28'});
 assert.equal(a.project_start_date,'2026-11-01');assert.equal(a.project_end_date,'2027-02-28');
 assert.throws(()=>service.saveApplication({...application,client_id:c.id,project_start_date:'2026-12-01',project_end_date:'2026-11-01'}),/передує/);
 assert.throws(()=>service.saveApplication({...application,client_id:c.id,project_start_date:'2026-02-30'}),/дату/);
});
test('CRM 1.4: партнер — сайт, соцмережі, команда й захист посилань',()=>{
 const repo=new LocalRepository(),service=new CrmService(repo);
 const p=service.saveCatalog('partners',{name:'Фонд «Демо»',type:'foundation',website:'https://example.invalid/site',social_links:[{platform:'facebook',url:'https://example.invalid/social',label:''}],staff:[{full_name:'Демо Працівник',role:'Координатор',email:'demo@example.invalid',phone:'+380 000000000',responsibilities:'Проєкти'}]});
 assert.equal(p.website,'https://example.invalid/site');
 assert.equal(p.social_links.length,1);assert.equal(p.staff[0].responsibilities,'Проєкти');
 assert.equal(new CrmService(repo).data().partners[0].staff[0].role,'Координатор');
 assert.throws(()=>service.saveCatalog('partners',{name:'Хибний',type:'ngo',website:'javascript:alert(1)'}),/HTTPS/);
 assert.throws(()=>service.saveCatalog('partners',{name:'Хибний',type:'ngo',social_links:[{platform:'facebook',url:'https://example.invalid/<script>'}]}),/HTTPS/);
 assert.throws(()=>service.saveCatalog('partners',{name:'Хибний',type:'ngo',staff:[{full_name:'',email:'bad'}]}),/співробітника/);
});
test('CRM 1.4: співробітники клієнта отримують поле обов’язків',()=>{
 const repo=new LocalRepository(),service=new CrmService(repo),c=service.saveClient(client);
 const person=service.addRelated('contacts',{client_id:c.id,full_name:'Тестова особа',email:'team@example.invalid',role:'Менеджер',responsibilities:'Грантові конкурси'});
 assert.equal(person.responsibilities,'Грантові конкурси');
 const updated=service.saveContact({client_id:c.id,full_name:'Тестова особа',responsibilities:'Звіти'},person.id,1);
 assert.equal(updated.responsibilities,'Звіти');
});
test('CRM 1.4: локальний код інтерфейсу — суми з комою, місяці, друк',()=>{
 const code=fs.readFileSync('source/web/m2.js','utf8');
 const context=vm.createContext({D,Intl,Date,window:{addEventListener(){}},document:{addEventListener(){}},escapeHtml:String});
 vm.runInContext(code,context);
 assert.equal(context.parseGrantAmount('12500,50'),12500.5);
 assert.equal(context.parseGrantAmount('12500.00'),12500);
 assert.equal(context.parseGrantAmount('12500,00'),12500);
 assert.equal(context.parseGrantAmount('12 500,25'),12500.25);
 assert.equal(context.moneyFormValue(12500),'12500,00');
 assert.equal(context.moneyFormValue(12500.5),'12500,50');
 assert.equal(context.applicationAmount(0,'UAH'),'0,00 UAH');
 assert.throws(()=>context.parseGrantAmount('1,234'),/Сума/);
 assert.equal(context.projectMonths({project_start_date:'2026-11-01',project_end_date:'2027-02-28'}),4);
 assert.equal(context.projectMonths({project_start_date:'2026-11-01',project_end_date:'2026-11-30'}),1);
 assert.equal(context.projectMonths({}),null);
 assert.match(code,/printCrmCard/);
 assert.match(code,/#partner/);
 assert.match(fs.readFileSync('source/web/styles.css','utf8'),/@media print/);
 assert.match(fs.readFileSync('source/web/styles.css','utf8'),/application-row\.won/);
});
