'use strict';
// Необов’язкова перевірка з уже встановленим Playwright; залежності CRM не змінюються.
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const server=require('node:child_process').spawn(process.execPath,[path.join(__dirname,'serve.js')],{env:{...process.env,PORT:'4175'},windowsHide:true,stdio:['ignore','pipe','pipe']});
 await new Promise((resolve,reject)=>{server.stdout.on('data',chunk=>{if(String(chunk).includes('http://'))resolve();});server.once('error',reject);server.once('exit',code=>reject(Error('Локальний сервер завершився: '+code)));});
 try {
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const base=process.env.CRM_TEST_URL||'http://127.0.0.1:4175/';
  await page.goto(base+'#clients');await page.locator('#results tr').first().waitFor();
  assert.equal(await page.locator('nav a[href="#profile"]').count(),0);
  assert.equal(await page.locator('thead th').count(),12);
  assert.equal(await page.locator('#client-filters').isVisible(),false);
  const output=process.env.CRM_SCREENSHOTS;
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'clients-desktop.png'),fullPage:true});}
  await page.locator('#query').fill('немає-такого-клієнта');assert.match(await page.locator('#results').innerText(),/не знайдено/);
  await page.locator('#client-filter-toggle').click();await page.locator('#client-reset').click();
  await page.locator('[data-sort="legal_name"]').click();assert.equal(await page.locator('[data-column="legal_name"]').getAttribute('aria-sort'),'ascending');
  await page.locator('[data-sort="legal_name"]').click();assert.equal(await page.locator('[data-column="legal_name"]').getAttribute('aria-sort'),'descending');
  await page.locator('#results a').first().click();
  await page.locator('#edit-client').waitFor();await page.locator('#client-actions summary').focus();await page.keyboard.press('Enter');assert.equal(await page.locator('#client-actions').getAttribute('open'),'');await page.keyboard.press('Escape');assert.equal(await page.locator('#client-actions').getAttribute('open'),null);assert.equal(await page.locator('main input,main textarea,main select').count(),0);
  assert.deepEqual(await page.locator('[data-tab]').allTextContents(),['Огляд','Досьє','Контакти','Історія','Заявки','Документи','Партнери']);
  await page.getByRole('button',{name:'Досьє',exact:true}).click();assert.equal(await page.locator('main form').count(),0);
  await page.locator('#edit-client').click();await page.locator('[name="capacity_note"]').fill('Демо: перевірка збереження досьє');await page.getByRole('button',{name:'Зберегти клієнта',exact:true}).click();await page.locator('#edit-client').waitFor();
  assert.match(await page.locator('#profile-content').innerText(),/перевірка збереження досьє/);
  await page.getByRole('button',{name:'Огляд',exact:true}).click();await page.locator('#edit-client').click();await page.locator('[name="location"]').fill('Демо: тестове місто');await page.getByRole('button',{name:'Зберегти клієнта',exact:true}).click();await page.locator('#edit-client').waitFor();
  await page.getByRole('button',{name:'Досьє',exact:true}).click();assert.match(await page.locator('#profile-content').innerText(),/перевірка збереження досьє/);
  await page.getByRole('button',{name:'Контакти',exact:true}).click();assert.equal(await page.locator('main form').count(),0);
  await page.locator('#add-related').click();await page.locator('[name="full_name"]').fill('Демо: тестовий контакт');await page.getByRole('button',{name:'Додати запис',exact:true}).click();await page.locator('#add-related').waitFor();assert.match(await page.locator('#profile-content').innerText(),/тестовий контакт/);
  await page.getByRole('button',{name:'Редагувати контакт',exact:true}).last().click();await page.locator('[name="full_name"]').fill('Демо: контакт оновлено <img src=x onerror=alert(1)>');await page.getByRole('button',{name:'Зберегти контакт',exact:true}).click();await page.locator('#add-related').waitFor();assert.match(await page.locator('#profile-content').innerText(),/контакт оновлено <img/);assert.equal(await page.locator('#profile-content img').count(),0);
  await page.getByRole('button',{name:'Історія',exact:true}).click();await page.locator('#add-related').click();await page.locator('[name="summary"]').fill('Демо: тестова взаємодія');await page.getByRole('button',{name:'Додати запис',exact:true}).click();await page.locator('#add-related').waitFor();
  await page.getByRole('button',{name:'Заявки',exact:true}).click();assert.equal(await page.locator('main form').count(),0);
  assert.equal(await page.locator('.client-applications th').count(),7);
  assert.equal(await page.locator('.application-counts strong').count(),7);
  for(const key of ['application_no','title','grant','submission_at','deadline','amount','status']){
   await page.locator('[data-sort="'+key+'"]').click();
   const first=await page.locator('[data-column="'+key+'"]').getAttribute('aria-sort');
   await page.locator('[data-sort="'+key+'"]').click();
   assert.notEqual(await page.locator('[data-column="'+key+'"]').getAttribute('aria-sort'),first);
  }
  await page.setViewportSize({width:360,height:800});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#client-actions summary').click();await page.locator('#archive').click();await page.locator('#archive').waitFor({state:'attached'});await page.locator('#client-actions summary').click();await page.locator('#archive').click();await page.locator('#archive').waitFor({state:'attached'});
  await page.goto(base+'#clients');await page.locator('a[href="#profile"]').click();assert.equal(await page.locator('form input,form select,form textarea').count(),5);
  await page.locator('[name="legal_name"]').fill('Демо: UI клієнт');await page.getByRole('button',{name:'Зберегти клієнта',exact:true}).click();await page.locator('#edit-client').waitFor();
  await page.getByRole('link',{name:'+ Заявка клієнта',exact:true}).click();await page.locator('[name="title"]').fill('Демо: UI заявка');await page.locator('[name="grant"]').fill('Демо: Конкурс');await page.locator('[name="donor"]').fill('Демо: Донор');await page.getByRole('button',{name:'Зберегти заявку',exact:true}).click();await page.locator('#application-rows').waitFor();
  await page.getByRole('link',{name:'Демо: UI заявка',exact:true}).click();assert.equal(await page.locator('main form').count(),0);await page.locator('#edit-application').click();await page.locator('#archive-application').click();await page.getByRole('button',{name:'Відновити з архіву',exact:true}).waitFor();await page.locator('#archive-application').click();await page.getByRole('button',{name:'Архівувати',exact:true}).waitFor();
  await page.locator('#delete-application').click();await page.getByRole('button',{name:'Підтвердити видалення',exact:true}).click();await page.locator('#application-rows').waitFor();assert.equal(await page.getByRole('link',{name:'Демо: UI заявка',exact:true}).count(),0);
  await page.goto(base+'#clients');await page.locator('#query').fill('Демо: UI клієнт');await page.locator('#results a').click();await page.locator('#client-actions summary').click();await page.locator('#delete-client').click();await page.getByRole('button',{name:'Підтвердити видалення',exact:true}).click();await page.locator('#results').waitFor();assert.equal(await page.locator('#results a').count(),0);
  await page.locator('#query').fill('');await page.setViewportSize({width:360,height:800});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));
  if(output)await page.screenshot({path:path.join(output,'clients-mobile.png'),fullPage:true});
  await page.locator('#results a').first().click();await page.locator('#edit-client').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(output)await page.screenshot({path:path.join(output,'client-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Досьє',exact:true}).click();await page.locator('#edit-client').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#cancel-edit').click();await page.reload();await page.locator('#edit-client').waitFor();assert.equal(await page.locator('main form').count(),0);

  // CRM 1.2: тільки локальні синтетичні записи; жодного відкриття Drive URL.
  const ids=await page.evaluate(async()=>{
   const c=await crm.saveClient({legal_name:'Демо: CRM12 клієнт',type:'ngo',status:'active',edrpou_optional:'00123456'});
   const c2=await crm.saveClient({legal_name:'Демо: CRM12 другий',type:'individual',status:'active'});
   const a=await crm.saveApplication({client_id:c.id,title:'Демо: CRM12 заявка',grant:'Демо: Конкурс',donor:'Демо: Донор',currency:'EUR',amount:null,status:'preparation',deadline:'2026-03-28T22:30:00Z'});
   refreshData();return {client:c.id,second:c2.id,app:a.id};
  });
  for(const width of [1440,360]){
   await page.setViewportSize({width,height:900});await page.goto(base+'#home');await page.locator('#application-group').waitFor();
   await page.locator('#application-group').check();assert.equal(await page.locator('thead th').count(),5);
   assert.equal(await page.locator('.application-row').first().locator('td').count(),5);
   assert.equal(await page.locator('.application-row a[href^="#profile/"]').count(),0);
   assert.equal(await page.locator('.client-group th').first().getAttribute('colspan'),'5');
   assert.ok(await page.locator('.client-group a[href^="#profile/"]').count()>0);
   await page.locator('[data-sort="deadline"]').click();assert.notEqual(await page.locator('[data-column="deadline"]').getAttribute('aria-sort'),'none');
   await page.locator('#application-group').uncheck();assert.equal(await page.locator('thead th').count(),6);
   assert.equal(await page.locator('.application-row').first().locator('td').count(),6);
   assert.ok(await page.locator('.application-row a[href^="#profile/"]').count()>0);
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.goto(base+'#clients');await page.locator('#query').fill('00123456');assert.equal(await page.locator('#results a').count(),1);
   assert.match(await page.locator('#results').innerText(),/00123456/);await page.locator('[data-sort="edrpou_optional"]').click();
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.goto(base+'#application/'+ids.app);await page.locator('#edit-application').click();
  assert.equal(await page.locator('[name="deadline"]').getAttribute('type'),'date');assert.equal(await page.locator('[name="deadline"]').inputValue(),'2026-03-29');
  await page.locator('[name="official_url"]').fill('https://example.invalid/grant');await page.locator('[name="title"]').fill('Демо: CRM12 змінено');await page.getByRole('button',{name:'Зберегти заявку',exact:true}).click();await page.locator('#application-rows').waitFor();
  assert.equal(await page.evaluate(id=>crm.data().applications.find(a=>a.id===id).deadline,ids.app),'2026-03-28T22:30:00Z');
  await page.goto(base+'#application/'+ids.app);assert.equal(await page.locator('a[href="https://example.invalid/grant"]').getAttribute('rel'),'noopener noreferrer');
  await page.locator('#edit-application').click();await page.locator('[name="deadline"]').fill('2026-10-25');await page.getByRole('button',{name:'Зберегти заявку',exact:true}).click();await page.locator('#application-rows').waitFor();
  assert.equal(await page.evaluate(id=>crm.data().applications.find(a=>a.id===id).deadline,ids.app),'2026-10-25');
  await page.goto(base+'#profile/'+ids.client);await page.getByRole('button',{name:'Партнери',exact:true}).click();await page.locator('#partner-create').click();
  await page.locator('[name="name"]').fill('Демо: CRM12 партнер <img src=x onerror=alert(1)>');await page.locator('[name="contacts"]').fill('demo@example.invalid');await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.locator('#catalog-add').waitFor();
  await page.locator('#catalog-add').click();const partnerId=await page.locator('[name="partner_id"] option').last().getAttribute('value');await page.locator('[name="partner_id"]').selectOption(partnerId);await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.locator('#catalog-add').waitFor();
  assert.equal(await page.locator('#profile-content img').count(),0);assert.match(await page.locator('#profile-content').innerText(),/demo@example.invalid/);
  await page.getByRole('button',{name:'Документи',exact:true}).click();await page.locator('#catalog-add').click();
  assert.match(await page.locator('#profile-content').innerText(),/Спочатку завантажте/);
  await page.locator('[name="title"]').fill('Демо: CRM12 меморандум <img>');await page.locator('[name="category"]').selectOption('memorandum');await page.locator('[name="url"]').fill('javascript:alert(1)');await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#form-result')?.textContent.includes('HTTPS'));assert.match(await page.locator('#form-result').innerText(),/HTTPS/);
  await page.locator('[name="url"]').fill('https://drive.google.com/file/d/synthetic-not-a-real-file/view');await page.locator('[name="document_date"]').fill('2026-10-17');await page.locator('[name="application_id"]').selectOption(ids.app);
  const linkId=await page.locator('[name="client_partner_id"] option').last().getAttribute('value');await page.locator('[name="client_partner_id"]').selectOption(linkId);
  await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.locator('#catalog-add').waitFor();assert.equal(await page.locator('#profile-content img').count(),0);
  assert.equal(await page.getByRole('link',{name:'Відкрити',exact:true}).getAttribute('rel'),'noopener noreferrer');
  await page.locator('[data-catalog-edit]').click();assert.equal(await page.locator('[name="document_date"]').inputValue(),'2026-10-17');await page.locator('[name="note"]').fill('Демо: Коментар');await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.locator('#catalog-add').waitFor();
  for(const width of [1440,360]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(output)await page.screenshot({path:path.join(output,'documents-'+width+'.png'),fullPage:true});}
  await page.getByRole('button',{name:'Партнери',exact:true}).click();await page.locator('[data-catalog-edit]').click();await page.locator('[name="memorandum"]').selectOption('true');await page.locator('[name="memorandum_date"]').fill('2026-10-17');
  const docId=await page.locator('[name="memorandum_document_id"] option').last().getAttribute('value');await page.locator('[name="memorandum_document_id"]').selectOption(docId);await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.locator('#catalog-add').waitFor();assert.match(await page.locator('#profile-content').innerText(),/CRM12 меморандум/);
  for(const width of [1440,360]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(output)await page.screenshot({path:path.join(output,'partners-'+width+'.png'),fullPage:true});}
  await page.goto(base+'#profile/'+ids.second);await page.getByRole('button',{name:'Партнери',exact:true}).click();await page.locator('#catalog-add').click();await page.locator('[name="partner_id"]').selectOption(partnerId);await page.getByRole('button',{name:'Зберегти',exact:true}).click();await page.locator('#catalog-add').waitFor();
  assert.equal(await page.evaluate(()=>crm.data().partners.length),1);
  await page.goto(base+'#profile/'+ids.client);await page.getByRole('button',{name:'Партнери',exact:true}).click();await page.locator('[data-catalog-remove]').click();assert.match(await page.locator('dialog').innerText(),/інші клієнти/);await page.getByRole('button',{name:'Підтвердити видалення',exact:true}).click();await page.locator('#catalog-add').waitFor();
  assert.equal(await page.evaluate(()=>crm.data().client_partners.length),1);assert.equal(await page.evaluate(()=>crm.data().documents.length),1);
  await page.getByRole('button',{name:'Документи',exact:true}).click();await page.locator('[data-catalog-remove]').click();assert.match(await page.locator('dialog').innerText(),/Файл Google Drive залишиться/);await page.getByRole('button',{name:'Підтвердити видалення',exact:true}).click();await page.locator('#catalog-add').waitFor();assert.equal(await page.evaluate(()=>crm.data().documents.length),0);

  assert.deepEqual(errors,[]);console.log('UI: настільний 1440px і мобільний 360px; таблиця, перегляд, редагування, досьє, контакти, історія, CRUD заявок/клієнтів — успішно.');
 }finally{await browser.close();}
 }finally{server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
