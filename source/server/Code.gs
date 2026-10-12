// М1: відмова за замовчуванням до реалізації та перевірки доступу власника.
function doGet() {
  return HtmlService.createHtmlOutput('<html lang="uk"><meta charset="utf-8"><h1>Доступ закрито</h1><p>М1 доступний лише як локальний демонстраційний прототип.</p></html>');
}
