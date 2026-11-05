// Лише ці точки входу доступні google.script.run; допоміжні функції приватні.
function crmHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0'+((byte+256)%256).toString(16)).slice(-2); }).join('');
}
function crmDiagnostics_(properties) {
  // Вмикається власником лише у відокремленому тестовому Script-проєкті.
  if(properties.getProperty('CRM_ENVIRONMENT')!=='test'||properties.getProperty('CRM_DIAGNOSTICS_ENABLED')!=='true')return null;
  var mode=properties.getProperty('CRM_PROJECTION_READ_MODE');
  if(mode && mode!=='data_range' && mode!=='bounded_range')throw Error('Невідомий тестовий режим читання.');
  return {enabled:true,projectionReadMode:mode||'bounded_range',emit:function(report){console.log(JSON.stringify(report));}};
}
// Окремий ручний тест без recovery: pending відхиляється без записів.
function benchmarkCrmRead_() {
  var repository=crmRepository_();
  if(!repository.diagnostics)throw Error('Потрібна діагностика окремого тестового середовища.');
  repository.locked(function(){
    var control=repository.control();
    if(control.pending)throw Error('Спершу завершіть відновлення тестової бази.');
    var state=repository.journal(control.committed);
    repository.verifyProjection(state);
  });
}
function crmRepository_(request) {
  var properties=PropertiesService.getScriptProperties();
  CrmGateway.authorize(properties,Session);
  var id=properties.getProperty('CRM_SPREADSHEET_ID');
  if(!id)throw Error('Доступ закрито.');
  return new CrmSheets.SheetsRepository({
    spreadsheet:SpreadsheetApp.openById(id),lock:LockService.getScriptLock(),
    flush:function() { SpreadsheetApp.flush(); },hash:crmHash_,
    diagnostics:crmDiagnostics_(properties),
    expectedRevision:request?request.revision:null,
    request:request?{id:request.requestId,fingerprint:crmHash_(JSON.stringify(request))}:null
  });
}
function crmSafe_(action) {
  try { return {ok:true,value:action()}; }
  catch(error) {
    // Не повертаємо сирі помилки Google: вони можуть містити ID та приватні дані.
    if(error.message==='CALENDAR_NOT_CONFIGURED')return {ok:false,code:'CALENDAR_NOT_CONFIGURED',message:'Основний Google Calendar недоступний для цього акаунта. Перевірте дозвіл Calendar та налаштування власника.'};
    if(error.message==='CALENDAR_INVALID_TIME')return {ok:false,code:'CALENDAR_INVALID_TIME',message:'Некоректна дата, час або часовий пояс календарної дії. Перевірте введені дані.'};
    if(error.message==='CRM12_MIGRATION_REQUIRED')return {ok:false,code:'MIGRATION_REQUIRED',message:'Потрібна ручна міграція CRM 1.2 після приватного резервного копіювання. Зверніться до інструкції випуску; дані не змінено.'};
    var conflict=/Конфлікт|змінено або видалено/.test(error.message||'');
    return {ok:false,code:conflict?'CONFLICT':'UNAVAILABLE',message:conflict?
      'Дані змінено. Збережіть текст форми й оновіть дані перед новою спробою.':
      'Операцію не підтверджено. Збережіть форму. Повторіть той самий запит; не створюйте новий UUID до перевірки результату.'};
  }
}
function crmQuery(request) {
  return crmSafe_(function() {return CrmGateway.query(crmRepository_(),request);});
}
function crmMutate(request) {
  return crmSafe_(function() {
    // Відхиляємо неіснуючі/неоднозначні години ДО створення незмінного запису в CRM.
    // Інакше його дія залишиться у pending без можливості виправити час.
    if(request?.action==='addRelated'&&request.args?.table==='interactions'&&request.args.input?.calendar_action) {
      var action=request.args.input.calendar_action;
      crmCalendarLocalTime_(action.date,action.time,action.time_zone||'Europe/Istanbul');
    }
    return CrmGateway.mutate(crmRepository_(request),function(){return Utilities.getUuid();},request);
  });
}
// Синхронізація — лише за явним натисканням власника. Стандарт — його основний
// Google Calendar; CRM_CALENDAR_ID дає змогу явно вибрати інший власний календар.
// Жодні чужі календарі не редагуємо і не створюємо тут автоматично.
function crmCalendarLocalTime_(day,time,zone) {
  // Нові календарні дії мають Europe/Istanbul, але старі без time_zone
  // продовжують працювати у Europe/Kyiv, як їх було створено раніше.
  var tz=zone||'Europe/Kyiv';
  if(!['Europe/Kyiv','Europe/Istanbul'].includes(tz)||!CrmDomain.dateOnly(day)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('CALENDAR_INVALID_TIME');
  var value=Utilities.parseDate(day+' '+time,tz,'yyyy-MM-dd HH:mm');
  var expected=day+' '+time;
  // Весною локальні години можуть не існувати, восени повторюватись двічі.
  // Для неоднозначної години не обираємо UTC-зсув мовчки: власник має змінити час.
  if(Utilities.formatDate(value,tz,'yyyy-MM-dd HH:mm')!==expected||
     Utilities.formatDate(new Date(value.getTime()-3600000),tz,'yyyy-MM-dd HH:mm')===expected||
     Utilities.formatDate(new Date(value.getTime()+3600000),tz,'yyyy-MM-dd HH:mm')===expected)
    throw Error('CALENDAR_INVALID_TIME');
  return value;
}
// Спільна перевірка календаря без зміни його подій.
function crmOwnedCalendar_() {
  var props=PropertiesService.getScriptProperties();
  CrmGateway.authorize(props,Session);
  var calendarId=props.getProperty('CRM_CALENDAR_ID');
  var calendar=calendarId?CalendarApp.getCalendarById(calendarId):CalendarApp.getDefaultCalendar();
  if(!calendar||!calendar.isOwnedByMe())throw Error('CALENDAR_NOT_CONFIGURED');
  return calendar;
}
// Безпечна перевірка OAuth і прав: без записів у Google Sheets та Google Calendar.
function crmCalendarCheck() {
  return crmSafe_(function() {
    var calendar=crmOwnedCalendar_();
    return {ready:true,primary:calendar.isMyPrimaryCalendar(),timeZone:calendar.getTimeZone(),crmTimeZone:'Europe/Istanbul'};
  });
}
// Лише ручна перевірка в редакторі тестового Apps Script: жодних записів.
// Окрема публічна read-only функція без кінцевого _ для меню Run в Apps Script.
// Виводимо мінімальний результат, бо Apps Script не показує повернене значення
// crmCalendarCheck() у стандартному журналі виконання.
function verifyCrmCalendarAccess() {
  var result=crmCalendarCheck();
  if(result.ok===true&&result.value&&result.value.ready===true) {
    console.log('CRM_CALENDAR_CHECK_OK; primary='+String(result.value.primary===true)+
      '; timeZone='+String(result.value.timeZone||''));
    // Доступ підтверджено, але часовий пояс основного календаря може відрізнятися
    // від Europe/Istanbul, у якому CRM інтерпретує нові календарні дії.
    // Не змінюємо налаштування особистого календаря автоматично.
    if(result.value.timeZone!=='Europe/Istanbul')
      console.log('CRM_CALENDAR_TIMEZONE_WARNING; crmTimeZone=Europe/Istanbul; calendarTimeZone='+
        String(result.value.timeZone||'UNKNOWN'));
  } else {
    // Ніколи не журналюємо OAuth-токени, власника або сирі Google-помилки.
    console.log('CRM_CALENDAR_CHECK_FAILED; code='+String(result.code||'UNAVAILABLE'));
  }
}
// Тільки ручний read-only smoke-test часу Стамбула на тестовому Apps Script.
// Не викликає CalendarApp, не читає Sheets і не створює подій.
function verifyCrmIstanbulTime() {
  var examples=[
    {day:'2026-11-12',time:'10:00',utc:'2026-11-12T07:00:00.000Z'},
    {day:'2026-07-15',time:'10:00',utc:'2026-07-15T07:00:00.000Z'},
    {day:'2026-03-29',time:'03:30',utc:'2026-03-29T00:30:00.000Z'}
  ];
  try {
    for(var i=0;i<examples.length;i++) {
      var row=examples[i];
      if(crmCalendarLocalTime_(row.day,row.time,'Europe/Istanbul').toISOString()!==row.utc) {
        console.log('CRM_ISTANBUL_CLOCK_FAILED; case='+String(i+1));
        return;
      }
    }
    console.log('CRM_ISTANBUL_CLOCK_OK; zone=Europe/Istanbul; 10:00=07:00Z; samples=3; eventsCreated=0');
  }catch(error) {
    // Не журналюємо сирі помилки або системні відомості.
    console.log('CRM_ISTANBUL_CLOCK_FAILED; case=runtime');
  }
}
// Тільки ручний read-only контроль ізольованої CRM_1_4_TEST_DB.
// Ніколи не читати клієнтські рядки, не журналювати ID чи вміст комірок.
// SHA-256 тестового Spreadsheet ID блокує випадкову перевірку production.
function verifyCrmTestSheetConnection() {
  var props=PropertiesService.getScriptProperties();
  try {
    // Скрипт CRM 1.4 уже працює в окремому staging-проєкті. Автоматичний clasp
    // push НЕ встановлює CRM_ENVIRONMENT, тож не покладаємося на ручну зміну
    // властивостей та не просимо власника змінювати production Script Properties.
    // Той самий SHA-256 staging Script ID перевіряється у захищеному CI workflow.
    var expectedScriptHash='57ce0d272f5a4fd0ad8ebf73376f96601ddddb3623f43dd80fe6f2f171be0f7f';
    if(crmHash_(ScriptApp.getScriptId())!==expectedScriptHash) {
      console.log('CRM_TEST_SHEET_FAILED; code=TEST_SCRIPT_MISMATCH');
      return;
    }
    CrmGateway.authorize(props,Session);
    var id=props.getProperty('CRM_SPREADSHEET_ID');
    var expectedIdHash='4beceb3a77dc0f78da84a4624fa646c3403dcfe0bb90c06a559d1e6074c35656';
    if(!id||crmHash_(id)!==expectedIdHash) {
      console.log('CRM_TEST_SHEET_FAILED; code=TEST_SHEET_MISMATCH');
      return;
    }
    var book=SpreadsheetApp.openById(id);
    var sheets={};
    book.getSheets().forEach(function(sheet){sheets[sheet.getName()]=sheet;});
    var entityTabs=['clients','client_profiles','contacts','interactions',
      'grants','applications','documents','partners','client_partners'];
    for(var i=0;i<entityTabs.length;i++) {
      var sheet=sheets[entityTabs[i]];
      if(!sheet) {
        console.log('CRM_TEST_SHEET_FAILED; code=SCHEMA_MISMATCH');
        return;
      }
      var headers=sheet.getRange(1,1,1,4).getValues()[0];
      if(headers.join('|')!=='id|client_id|version|data_json') {
        console.log('CRM_TEST_SHEET_FAILED; code=SCHEMA_MISMATCH');
        return;
      }
    }
    if(!sheets._crm_control||!sheets._crm_journal||
       sheets._crm_control.getRange(1,1).getValue()!=='control_json'||
       sheets._crm_journal.getRange(1,1).getValue()!=='chunk') {
      console.log('CRM_TEST_SHEET_FAILED; code=SCHEMA_MISMATCH');
      return;
    }
    console.log('CRM_TEST_SHEET_OK; entityTabs=9; control=1; journal=1; recordRowsRead=0; writes=0');
  }catch(error) {
    // Жодних сирих помилок Google, Spreadsheet ID, приватного заголовка файлу чи даних.
    console.log('CRM_TEST_SHEET_FAILED; code=UNAVAILABLE');
  }
}
// Ручне read-only приймання цілісності ТІЛЬКИ погодженої тестової БД.
// На відміну від repository.read(), тут ніколи не викликаємо recover():
// pending-транзакція має блокувати перевірку, а не запускати запис/відновлення.
function verifyCrmTestDatabaseIntegrity() {
  var props=PropertiesService.getScriptProperties();
  try {
    // Незалежний захист від запуску в іншому, зокрема production, Apps Script.
    var expectedScriptHash='57ce0d272f5a4fd0ad8ebf73376f96601ddddb3623f43dd80fe6f2f171be0f7f';
    if(crmHash_(ScriptApp.getScriptId())!==expectedScriptHash) {
      console.log('CRM_TEST_INTEGRITY_FAILED; code=TEST_SCRIPT_MISMATCH');
      return;
    }
    CrmGateway.authorize(props,Session);
    var id=props.getProperty('CRM_SPREADSHEET_ID');
    var expectedIdHash='4beceb3a77dc0f78da84a4624fa646c3403dcfe0bb90c06a559d1e6074c35656';
    if(!id||crmHash_(id)!==expectedIdHash) {
      console.log('CRM_TEST_INTEGRITY_FAILED; code=TEST_SHEET_MISMATCH');
      return;
    }
    var repository=new CrmSheets.SheetsRepository({
      spreadsheet:SpreadsheetApp.openById(id),
      lock:LockService.getScriptLock(),
      hash:crmHash_,
      // Захист на рівні адаптера: навіть якщо помилково викличуть write path,
      // flush буде заборонено. Нормальний read-only шлях flush не викликає.
      flush:function(){throw Error('READ_ONLY_FLUSH_FORBIDDEN');}
    });
    var outcome='UNAVAILABLE';
    repository.locked(function() {
      var control=repository.control();
      if(control.pending) {outcome='PENDING_TRANSACTION';return;}
      if(!control.committed) {outcome='NO_COMMITTED_JOURNAL';return;}
      if(control.schema!==2) {outcome='SCHEMA_MISMATCH';return;}
      var state;
      try {state=repository.journal(control.committed);}
      catch(error) {outcome='JOURNAL_INVALID';return;}
      if(state.modelVersion!==12) {outcome='SCHEMA_MISMATCH';return;}
      try {repository.verifyProjection(state);}
      catch(error) {outcome='PROJECTION_MISMATCH';return;}
      outcome='OK';
    });
    if(outcome==='OK')
      console.log('CRM_TEST_INTEGRITY_OK; schema=2; model=12; projectionTabs=9; dataLogged=0; writes=0');
    else console.log('CRM_TEST_INTEGRITY_FAILED; code='+outcome);
  }catch(error) {
    // Не журналювати приватні дані, журнал транзакцій або сирі помилки Google.
    console.log('CRM_TEST_INTEGRITY_FAILED; code=UNAVAILABLE');
  }
}
// Ручне приймання CRUD тільки на НОВІЙ окремій синтетичній таблиці Google Sheets.
// Не змінює існуючу CRM_1_4_TEST_DB або продуктивні дані, не викликає CalendarApp.
// Створена синтетична таблиця лишається у приватному Drive власника для аудиту.
function verifyCrmIsolatedSyntheticCrud() {
  try {
    var props=PropertiesService.getScriptProperties();
    var expectedScriptHash='57ce0d272f5a4fd0ad8ebf73376f96601ddddb3623f43dd80fe6f2f171be0f7f';
    if(crmHash_(ScriptApp.getScriptId())!==expectedScriptHash) {
      console.log('CRM_SYNTHETIC_CRUD_FAILED; code=TEST_SCRIPT_MISMATCH');
      return;
    }
    CrmGateway.authorize(props,Session);
    // Перед створенням додаткового файлу ще раз перевіряємо прив'язку до
    // погодженої тестової БД, але саму БД навіть не відкриваємо.
    var expectedIdHash='4beceb3a77dc0f78da84a4624fa646c3403dcfe0bb90c06a559d1e6074c35656';
    var configuredId=props.getProperty('CRM_SPREADSHEET_ID');
    if(!configuredId||crmHash_(configuredId)!==expectedIdHash) {
      console.log('CRM_SYNTHETIC_CRUD_FAILED; code=TEST_SHEET_MISMATCH');
      return;
    }
    var scratch=SpreadsheetApp.create('CRM_1_4_SYNTHETIC_CRUD_'+Utilities.getUuid().slice(0,8));
    var repository=new CrmSheets.SheetsRepository({
      spreadsheet:scratch,lock:LockService.getScriptLock(),
      flush:function(){SpreadsheetApp.flush();},hash:crmHash_
    });
    repository.setup();
    // Тільки нова порожня синтетична таблиця: не мігруємо існуючих клієнтів.
    repository.migrate12(0,true);
    var service=new CrmCore.CrmService(repository,function(){return Utilities.getUuid();});
    var client=service.saveClient({
      legal_name:'CRM 1.4 СИНТЕТИЧНА ТЕСТОВА ОРГАНІЗАЦІЯ',
      type:'ngo',status:'active'
    });
    var changed=service.saveClient({
      legal_name:'CRM 1.4 СИНТЕТИЧНА ОРГАНІЗАЦІЯ (оновлена)',
      type:'ngo',status:'active'
    },client.id,client.version);
    var application=service.saveApplication({
      client_id:client.id,title:'СИНТЕТИЧНА ЗАЯВКА CRM 1.4',
      grant:'СИНТЕТИЧНИЙ КОНКУРС',donor:'СИНТЕТИЧНИЙ ДОНОР',
      status:'preparation',currency:'EUR',amount:null
    });
    service.addRelated('contacts',{
      client_id:client.id,full_name:'Синтетичний тестовий контакт'
    });
    var interaction=service.addRelated('interactions',{
      client_id:client.id,summary:'Синтетична взаємодія — без Google Calendar',
      calendar_action:{title:'Тестова дія без синхронізації',date:'2026-11-12',
        time:'10:00',time_zone:'Europe/Istanbul',
        duration_minutes:15,reminder_minutes:5}
    });
    var state=repository.read();
    if(state.modelVersion!==12||state.clients.length!==1||
       state.clients[0].version!==changed.version||
       state.applications.length!==1||state.contacts.length!==1||
       state.interactions.length!==1||
       state.interactions[0].calendar_action.sync_status!=='pending')
      throw Error('SYNTHETIC_ASSERT_FAILED');
    service.updateCalendarAction(interaction.id,'cancel',state.interactions[0].version||1);
    service.applicationAction(application.id,'archive');
    service.applicationAction(application.id,'restore');
    service.deleteApplication(application.id,true);
    service.clientAction(client.id,'archive');
    service.clientAction(client.id,'restore');
    service.clientAction(client.id,'delete',true);
    state=repository.read();
    if(!state.clients[0].deleted_at||!state.applications[0].deleted_at||
       state.interactions[0].calendar_action.state!=='cancelled'||
       state.interactions[0].calendar_action.sync_status!=='pending'||
       state.interactions[0].calendar_action.event_id)
      throw Error('SYNTHETIC_ASSERT_FAILED');
    console.log('CRM_SYNTHETIC_CRUD_OK; scratchCreated=1; schema=12; clients=1; contacts=1; applications=1; interactions=1; calendarEvents=0; originalTestSheetWrites=0');
  }catch(error) {
    // Не виводимо назву/ID створеної таблиці чи приватні дані API.
    console.log('CRM_SYNTHETIC_CRUD_FAILED; code=UNAVAILABLE');
  }
}
// ОДИН дозволений власником live smoke test CRM → Google Calendar:
// 06.11.2026 11:00–11:15 Europe/Istanbul, popup за 5 хвилин.
// Виконується вручну тільки у погодженому окремому staging Apps Script.
// Синтетичну CRM створюємо у НОВІЙ Sheets; CRM_1_4_TEST_DB не змінюємо.
// Захист від випадкових повторів: одноразовий claim у staging Script Properties
// ДО будь-якого створення файлу/події. Після збою повторний Run не створить дубль.
function verifyCrmIsolatedCalendarSync() {
  var props=PropertiesService.getScriptProperties();
  var claimKey='CRM14_E2E_CALENDAR_20261106_1100_ISTANBUL';
  var claimed=false;
  try {
    var expectedScriptHash='57ce0d272f5a4fd0ad8ebf73376f96601ddddb3623f43dd80fe6f2f171be0f7f';
    if(crmHash_(ScriptApp.getScriptId())!==expectedScriptHash) {
      console.log('CRM_E2E_CALENDAR_FAILED; code=TEST_SCRIPT_MISMATCH');
      return;
    }
    CrmGateway.authorize(props,Session);
    var configuredId=props.getProperty('CRM_SPREADSHEET_ID');
    var expectedIdHash='4beceb3a77dc0f78da84a4624fa646c3403dcfe0bb90c06a559d1e6074c35656';
    if(!configuredId||crmHash_(configuredId)!==expectedIdHash) {
      console.log('CRM_E2E_CALENDAR_FAILED; code=TEST_SHEET_MISMATCH');
      return;
    }
    // Календар тільки основний і власний; не використовувати CRM_CALENDAR_ID
    // для цього одноразового приймання, навіть якщо такий property встановлено.
    var calendar=CalendarApp.getDefaultCalendar();
    if(!calendar||!calendar.isOwnedByMe()||!calendar.isMyPrimaryCalendar()) {
      console.log('CRM_E2E_CALENDAR_FAILED; code=PRIMARY_CALENDAR_REQUIRED');
      return;
    }
    var start=crmCalendarLocalTime_('2026-11-06','11:00','Europe/Istanbul');
    if(start.toISOString()!=='2026-11-06T08:00:00.000Z') {
      console.log('CRM_E2E_CALENDAR_FAILED; code=TIMEZONE_MISMATCH');
      return;
    }
    // Гарантуємо лише один новий захід, незалежно від повторних натискань Run.
    // ScriptLock утримується ЛИШЕ під час claim, не під час Sheets/Calendar API.
    var guard=LockService.getScriptLock();
    if(!guard.tryLock(10000)) {
      console.log('CRM_E2E_CALENDAR_FAILED; code=BUSY');
      return;
    }
    try {
      if(props.getProperty(claimKey)) {
        console.log('CRM_E2E_CALENDAR_ALREADY_CLAIMED; noNewEvents=1');
        return;
      }
      props.setProperty(claimKey,'CLAIMED');
      claimed=true;
    }finally {guard.releaseLock();}

    var scratch=SpreadsheetApp.create('CRM_1_4_E2E_CALENDAR_'+Utilities.getUuid().slice(0,8));
    // ID для приватного read-only аудиту після збою (не виводити у logs).
    props.setProperty(claimKey+'_SHEET_ID',scratch.getId());
    var repository=new CrmSheets.SheetsRepository({
      spreadsheet:scratch,lock:LockService.getScriptLock(),
      flush:function(){SpreadsheetApp.flush();},hash:crmHash_
    });
    repository.setup();
    repository.migrate12(0,true);
    var service=new CrmCore.CrmService(repository,function(){return Utilities.getUuid();});
    var client=service.saveClient({
      legal_name:'CRM 1.4 СИНТЕТИЧНА ТЕСТОВА ОРГАНІЗАЦІЯ',
      type:'ngo',status:'active'
    });
    var interaction=service.addRelated('interactions',{
      client_id:client.id,summary:'Синтетичне тестування Calendar CRM 1.4',
      calendar_action:{
        title:'CRM 1.4 — тест нагадування',
        date:'2026-11-06',time:'11:00',time_zone:'Europe/Istanbul',
        duration_minutes:15,reminder_minutes:5
      }
    });
    var before=repository.read();
    if(before.interactions.length!==1||
       before.interactions[0].id!==interaction.id||
       before.interactions[0].calendar_action.sync_status!=='pending')
      throw Error('CRM_E2E_PRECONDITION_FAILED');

    // Цей виклик застосовує САМЕ продуктивний модуль CRM календарної синхронізації,
    // однак лише до однієї нової синтетичної бази. Ніяких інших pending подій.
    var result=CrmCalendar.syncPending(repository,calendar,crmCalendarLocalTime_,function(){return new Date();},1);
    if(result.synced!==1||result.failed!==0||result.pending!==0)
      throw Error('CRM_E2E_SYNC_FAILED');
    var state=repository.read();
    var task=state.interactions[0].calendar_action;
    if(task.sync_status!=='synced'||!task.event_id||task.time_zone!=='Europe/Istanbul')
      throw Error('CRM_E2E_STATE_FAILED');
    var event=calendar.getEventById(task.event_id);
    if(!event||
       event.getStartTime().toISOString()!=='2026-11-06T08:00:00.000Z'||
       event.getEndTime().toISOString()!=='2026-11-06T08:15:00.000Z'||
       event.getDescription().split(/\r?\n/).indexOf('CRM-ACTION:'+interaction.id)<0||
       event.getPopupReminders().indexOf(5)<0)
      throw Error('CRM_E2E_EVENT_FAILED');
    if(typeof event.getVisibility==='function'&&
       event.getVisibility()!==CalendarApp.Visibility.PRIVATE)
      throw Error('CRM_E2E_VISIBILITY_FAILED');
    // Перевірка ідемпотентності: повторний sync не створює нових подій.
    var retry=CrmCalendar.syncPending(repository,calendar,crmCalendarLocalTime_,function(){return new Date();},1);
    if(retry.synced!==0||retry.failed!==0)throw Error('CRM_E2E_RETRY_FAILED');
    props.setProperty(claimKey,'DONE');
    console.log('CRM_E2E_CALENDAR_OK; date=2026-11-06; time=11:00-11:15; zone=Europe/Istanbul; reminder=5; synced=1; repeatSynced=0; originalTestSheetWrites=0');
  }catch(error) {
    // Залишити claim, навіть якщо API не відповів після створення події.
    // Повторний Run блокується, щоб не створити друге особисте нагадування.
    if(claimed) {
      try {props.setProperty(claimKey,'CHECK_MANUALLY');}catch(ignored){}
    }
    console.log('CRM_E2E_CALENDAR_FAILED; code=CHECK_MANUALLY; noAutomaticRetry=1');
  }
}
function crmCalendarSync() {
  return crmSafe_(function() {
    var calendar=crmOwnedCalendar_();
    return CrmCalendar.syncPending(crmRepository_(),calendar,crmCalendarLocalTime_,function(){return new Date();},5);
  });
}
// Запускаються вручну в редакторі власника; суфікс _ закриває виклик з браузера.
function setupCrm_() { return crmSafe_(function(){return crmRepository_().setup();}); }
function backupCrm_() { return crmSafe_(function(){return crmRepository_().snapshot();}); }
function restoreCrm_(snapshot,expectedRevision) {
  return crmSafe_(function() {
    var repository=crmRepository_();
    if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0)throw Error('Потрібна ревізія бази.');
    repository.expectedRevision=expectedRevision;
    return repository.restore(snapshot);
  });
}
function repairCrm_(expectedRevision,confirmed) {
  return crmSafe_(function(){return crmRepository_().repairProjection(expectedRevision,confirmed);});
}
function doGet() {
  try {
    CrmGateway.authorize(PropertiesService.getScriptProperties(),Session);
    return HtmlService.createHtmlOutputFromFile('Index').setTitle('Каталог клієнтів').addMetaTag('viewport','width=device-width, initial-scale=1');
  } catch(error) {
    return HtmlService.createHtmlOutput('<html lang="uk"><meta charset="utf-8"><h1>Доступ закрито</h1></html>');
  }
}

function migrateCrm12_(expectedRevision,backupConfirmed) {
  return crmSafe_(function(){return crmRepository_().migrate12(expectedRevision,backupConfirmed);});
}

function inspectCrm12_() {
  return crmSafe_(function(){var state=crmRepository_().read();return {revision:state.revision,modelVersion:state.modelVersion||11,counts:Object.fromEntries(['clients','applications','contacts','interactions','documents','partners','client_partners'].map(function(key){return [key,(state[key]||[]).length];}))};});
}
