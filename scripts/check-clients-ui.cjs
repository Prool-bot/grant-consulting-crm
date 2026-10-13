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
  assert.equal(await page.locator('thead th').count(),7);
  assert.equal(await page.locator('#client-filters').isVisible(),false);
  const output=process.env.CRM_SCREENSHOTS;
  if(output){fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,'clients-desktop.png'),fullPage:true});}
  await page.locator('#query').fill('немає-такого-клієнта');assert.match(await page.locator('#results').innerText(),/не знайдено/);
  await page.locator('#client-filter-toggle').click();await page.locator('#client-reset').click();
  await page.locator('[data-sort="legal_name"]').click();assert.equal(await page.locator('[data-column="legal_name"]').getAttribute('aria-sort'),'ascending');
  await page.locator('[data-sort="legal_name"]').click();assert.equal(await page.locator('[data-column="legal_name"]').getAttribute('aria-sort'),'descending');
  await page.locator('#results a').first().click();
  await page.locator('#edit-client').waitFor();assert.equal(await page.locator('main input,main textarea,main select').count(),0);
  assert.deepEqual(await page.locator('[data-tab]').allTextContents(),['Огляд','Досьє','Контакти','Історія','Заявки']);
  await page.getByRole('button',{name:'Досьє',exact:true}).click();assert.equal(await page.locator('main form').count(),0);
  await page.locator('#edit-client').click();await page.locator('[name="capacity_note"]').fill('Демо: перевірка збереження досьє');await page.getByRole('button',{name:'Зберегти клієнта',exact:true}).click();await page.locator('#edit-client').waitFor();
  assert.match(await page.locator('#profile-content').innerText(),/перевірка збереження досьє/);
  await page.getByRole('button',{name:'Огляд',exact:true}).click();await page.locator('#edit-client').click();await page.locator('[name="location"]').fill('Демо: тестове місто');await page.getByRole('button',{name:'Зберегти клієнта',exact:true}).click();await page.locator('#edit-client').waitFor();
  await page.getByRole('button',{name:'Досьє',exact:true}).click();assert.match(await page.locator('#profile-content').innerText(),/перевірка збереження досьє/);
  await page.getByRole('button',{name:'Контакти',exact:true}).click();assert.equal(await page.locator('main form').count(),0);
  await page.locator('#add-related').click();await page.locator('[name="full_name"]').fill('Демо: тестовий контакт');await page.getByRole('button',{name:'Додати запис',exact:true}).click();await page.locator('#add-related').waitFor();assert.match(await page.locator('#profile-content').innerText(),/тестовий контакт/);
  await page.getByRole('button',{name:'Історія',exact:true}).click();await page.locator('#add-related').click();await page.locator('[name="summary"]').fill('Демо: тестова взаємодія');await page.getByRole('button',{name:'Додати запис',exact:true}).click();await page.locator('#add-related').waitFor();
  await page.getByRole('button',{name:'Заявки',exact:true}).click();assert.equal(await page.locator('main form').count(),0);
  await page.locator('#archive').click();await page.getByRole('button',{name:'Відновити з архіву',exact:true}).waitFor();await page.locator('#archive').click();await page.getByRole('button',{name:'Архівувати',exact:true}).waitFor();
  await page.goto(base+'#clients');await page.locator('a[href="#profile"]').click();assert.equal(await page.locator('form input,form select,form textarea').count(),5);
  await page.locator('[name="legal_name"]').fill('Демо: UI клієнт');await page.getByRole('button',{name:'Зберегти клієнта',exact:true}).click();await page.locator('#edit-client').waitFor();
  await page.getByRole('link',{name:'+ Заявка клієнта',exact:true}).click();await page.locator('[name="title"]').fill('Демо: UI заявка');await page.locator('[name="grant"]').fill('Демо: Конкурс');await page.locator('[name="donor"]').fill('Демо: Донор');await page.getByRole('button',{name:'Зберегти заявку',exact:true}).click();await page.locator('#application-rows').waitFor();
  await page.getByRole('link',{name:'Демо: UI заявка',exact:true}).click();await page.locator('#archive-application').click();await page.getByRole('button',{name:'Відновити з архіву',exact:true}).waitFor();await page.locator('#archive-application').click();await page.getByRole('button',{name:'Архівувати',exact:true}).waitFor();
  await page.locator('#delete-application').click();await page.getByRole('button',{name:'Підтвердити видалення',exact:true}).click();await page.locator('#application-rows').waitFor();assert.equal(await page.getByRole('link',{name:'Демо: UI заявка',exact:true}).count(),0);
  await page.goto(base+'#clients');await page.locator('#query').fill('Демо: UI клієнт');await page.locator('#results a').click();await page.locator('#delete-client').click();await page.getByRole('button',{name:'Підтвердити видалення',exact:true}).click();await page.locator('#results').waitFor();assert.equal(await page.locator('#results a').count(),0);
  await page.locator('#query').fill('');await page.setViewportSize({width:360,height:800});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.ok(await page.locator('.table-scroll').evaluate(e=>e.scrollWidth>e.clientWidth));
  if(output)await page.screenshot({path:path.join(output,'clients-mobile.png'),fullPage:true});
  await page.locator('#results a').first().click();await page.locator('#edit-client').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  if(output)await page.screenshot({path:path.join(output,'client-mobile.png'),fullPage:true});
  await page.getByRole('button',{name:'Досьє',exact:true}).click();await page.locator('#edit-client').click();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('#cancel-edit').click();await page.reload();await page.locator('#edit-client').waitFor();assert.equal(await page.locator('main form').count(),0);
  assert.deepEqual(errors,[]);console.log('UI: настільний 1440px і мобільний 360px; таблиця, перегляд, редагування, досьє, контакти, історія, CRUD заявок/клієнтів — успішно.');
 }finally{await browser.close();}
 }finally{server.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
