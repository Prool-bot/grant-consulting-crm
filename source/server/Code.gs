// Лише ці точки входу доступні google.script.run; допоміжні функції приватні.
function crmHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,text,Utilities.Charset.UTF_8)
    .map(function(byte) { return ('0'+((byte+256)%256).toString(16)).slice(-2); }).join('');
}
function crmRepository_(request) {
  var properties=PropertiesService.getScriptProperties();
  CrmGateway.authorize(properties,Session);
  var id=properties.getProperty('CRM_SPREADSHEET_ID');
  if(!id)throw Error('Доступ закрито.');
  return new CrmSheets.SheetsRepository({
    spreadsheet:SpreadsheetApp.openById(id),lock:LockService.getScriptLock(),
    flush:function() { SpreadsheetApp.flush(); },hash:crmHash_,
    expectedRevision:request?request.revision:null,
    request:request?{id:request.requestId,fingerprint:crmHash_(JSON.stringify(request))}:null
  });
}
function crmSafe_(action) {
  try { return {ok:true,value:action()}; }
  catch(error) {
    // Не повертаємо сирі помилки Google: вони можуть містити ID та приватні дані.
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
