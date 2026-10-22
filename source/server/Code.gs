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
  return {enabled:true,projectionReadMode:mode||'data_range',emit:function(report){console.log(JSON.stringify(report));}};
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
  return crmSafe_(function() {return CrmGateway.mutate(crmRepository_(request),function(){return Utilities.getUuid();},request);});
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
