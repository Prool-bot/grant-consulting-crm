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
