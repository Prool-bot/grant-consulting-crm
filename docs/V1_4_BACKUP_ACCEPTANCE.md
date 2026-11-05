# CRM 1.4 — завершальне приймання backup, restore і rollback

**Статус (05.11.2026):** браузерну роботу CRM 1.4 власник підтвердив словами «все працює». Це етап 3/4. Цей документ описує останній етап 4/4; **поки жодної дії з робочою CRM 1.3 чи production backup не виконано**.

## Етап 4А: справжні Google Sheets, тільки вигадані дані

В ізольованому тестовому Apps Script власник запускає рівно **один раз** `verifyCrmIsolatedBackupRestore()`. Перед створенням файлів функція перевіряє:

- SHA-256 погодженого **staging Script ID** (не production), авторизацію власника.
- SHA-256 погодженого тестового `CRM_SPREADSHEET_ID` — **без відкриття** існуючої `CRM_1_4_TEST_DB`, будь-яких робочих клієнтів чи production.
- Одноразовий прапорець `CRM14_BACKUP_RESTORE_SYNTHETIC_20261105` у приватних Script Properties тестового проєкту, під lock. Повторні запуски не створюють інших файлів.

Функція створює **два нові приватні файли Google Sheets** у Drive власника: `CRM_1_4_BACKUP_SYNTHETIC_SOURCE_...` та `CRM_1_4_RESTORE_SYNTHETIC_TARGET_...`. Вона створює тільки одного вигаданого клієнта і вигадану заявку в SOURCE, знімає `SheetsRepository.snapshot()`, створює інший тимчасовий синтетичний рядок у TARGET, після чого виконує `SheetsRepository.restore(snapshot)` **лише в TARGET**. Далі перевіряє зв’язок заявки, суму, номер версії, контрольну ревізію, цілісність проєкції та те, що SOURCE не змінений. Ні CalendarApp, ні вже існуюча тестова БД не беруть участі.

Очікуваний контрольований рядок:

`CRM_BACKUP_RESTORE_OK; scratchFiles=2; model=12; clients=1; applications=1; sourceUnchanged=1; originalTestSheetWrites=0; productionWrites=0; calendarEvents=0`.

У випадку `CRM_BACKUP_RESTORE_FAILED; code=CHECK_MANUALLY; noAutomaticRetry=1` або `CRM_BACKUP_RESTORE_ALREADY_CLAIMED` **не запускати повторно, не очищувати Script Properties**: можлива неповна операція, а ID обох створених копій збережені лише у приватних властивостях staging Apps Script. Не передавати ці ID або вміст Sheets до чату чи GitHub. Знайти і перевірити файли можна за їхніми синтетичними назвами у приватному Google Drive.

## Етап 4Б: контроль справжньої production CRM перед оновленням

**Окреме погодження власника обов'язкове.** Синтетичний тест вище **не є production backup** і сам по собі **не дозволяє реліз**.

Перед оновленням робочої CRM 1.3:
1. Встановити та приватно зберегти **точний production Spreadsheet ID**, чинні Apps Script Script ID, WebApp deployment ID, **номер версії** deployed WebApp, поточні Script Properties і налаштування доступу. Не додавати їх до публічного GitHub, повідомлень чи журналів.
2. Створити **свіжу приватну незалежну копію** чинної production Google Sheets через Google Drive, переконатися, що це **інший файл**, права доступу не розширені та жодні користувацькі дані не змінено.
3. Лише **на ще одній приватній контрольній копії**, не на production, довести що backup можна відкрити і відновити без втрати клієнтів, контактів, заявок, зв’язків, історії та journal pointer. За будь-якої невідповідності — **зупинити випуск**.
4. Скласти приватний rollback: повернення попереднього **deployed version** в **тому самому production deployment ID**, плюс план відновлення Sheets із захищеної копії **лише якщо це окремо погоджено**. Не обнуляти робочу базу і не запускати destructive repair.
5. Тільки після ручного рішення власника дозволено змінювати production Apps Script і той самий WebApp deployment. Не створювати новий production WebApp URL.

**Критерій завершення CRM 1.4:** `CRM_BACKUP_RESTORE_OK` на синтетичних файлах **і** підтверджена свіжа приватна production копія, перевірений rollback/restore на копії, браузерне приймання та явне рішення власника на реліз. PR #10 зберігати Draft до виконання цих умов.
