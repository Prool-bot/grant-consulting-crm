# Модель даних (Google Sheets)

Фізичний формат підготовленого адаптера М2.5 описано в [M25_SHEETS.md](M25_SHEETS.md): колонки `id`, `client_id`, `version`, `data_json`, окремі профілі й грантові реквізити, службовий журнал. Наведена нижче таблиця залишається цільовою логічною моделлю всіх етапів; М2.5 не створює модулі завдань, фінансів, календаря чи ШІ.

**Правила:** кожна таблиця окремим аркушем `CRM_DB`; первинний ключ `id` = UUID; зв'язки — за UUID, не за номером рядка; `created_at`, `updated_at` — ISO 8601; `deleted_at` для м'якого видалення; ні паролів, ні документів, ні API ключів в Sheets.

| Аркуш | Основні поля | Примітки |
|---|---|---|
| `clients` | id, client_no, type, legal_name, short_name, edrpou_optional, location, website, source, status, priority, owner, description, next_action_at, created_at, updated_at, deleted_at | type: ngo/foundation/company/entrepreneur/individual |
| `client_profiles` | id, client_id, target_groups, sectors, geography, prior_donors, grants_experience, org_budget_note, capacity_note, policies_checklist_json, funding_needs, eligibility_notes, updated_at | Додаткові поля за типом клієнта; чутливу інформацію не збирати без потреби |
| `contacts` | id, client_id, full_name, role, email, phone, preferred_channel, consent_note, created_at, updated_at | Кілька контактів на клієнта |
| `interactions` | id, client_id, contact_id, type, happened_at, summary, next_step, related_task_id, attachment_id, created_at | Журнал подій |
| `tasks` | id, title, description, client_id, grant_id, application_id, due_at, timezone, priority, status, assigned_to, reminder_scheme, calendar_event_id, calendar_sync_status, completed_at, created_at, updated_at | Ідемпотентність синхронізації |
| `grants` | id, title, donor, official_url, geography_json, applicant_types_json, sectors_json, amount_min, amount_max, currency, deadline_at, deadline_timezone, round, status, verified_at, created_at, updated_at | Без дублів за source/round |
| `matches` | id, client_id, grant_id, rules_score, reasons_json, blockers_json, status, analyzed_at, ai_analysis_id | Результат правил без ШІ |
| `applications` | id, application_no, client_id, grant_id, title, status, requested_amount, submission_at, award_amount, currency, donor_reply_at, notes, source_type, source_record_key, source_updated_at, imported_at, created_at, updated_at | Один клієнт → кілька заявок; client_id обов’язковий; імпорт — майбутній етап |
| `documents` | id, client_id, application_id, drive_file_id, drive_folder_id, doc_type, doc_status, expiry_at, uploaded_at, checked_at, note | Вміст файлів — лише Google Drive |
| `services_invoices` | id, client_id, service_name, agreement_drive_file_id, currency, amount, prepayment, paid, due_at, status, note | Управлінський фіноблік |
| `calendar_links` | id, entity_type, entity_id, calendar_id, event_id, payload_hash, last_synced_at, sync_status, error_message | Один зв'язок на сутність; unique(entity_type,entity_id) |
| `ai_ledger` | id, used_at, provider, model, action, input_hash, input_tokens_est, output_tokens_est, status, error_code | Без текстів клієнтських документів |
| `audit_log` | id, entity_type, entity_id, action, actor, occurred_at, changes_summary | Не логувати секрети |
| `settings` | key, value_json, updated_at | Без ключів і токенів; секрети в Script Properties |

### Файлова структура Google Drive
`CRM_Клієнти/0001_Назва/01_Реєстрація; 02_Політики; 03_Досвід; 04_Фінанси; 05_Заявки; 06_Договори; 07_Листування/`. Структуру створювати лише для активованого досьє. Назва папки може змінюватися, але `drive_folder_id` незмінний.

### Валідація
- Реєстр зв’язує заявку з досьє через client_id; назва клієнта не є ключем. Дедлайн/донор беруться зі зв’язаного гранту. У М1 назви гранту, донор і дедлайн денормалізовані лише для демонстрації; `amount` означає запитувану суму, всі приклади в EUR.
- Майбутній імпорт: унікальна пара (source_type, source_record_key), пріоритет стабільного UUID; номер рядка Sheets не є ключем. Для файлів без ключів показувати кандидати на дублікати за client_id + grant_id + раундом/назвою заявки, вимагати рішення при неоднозначності. Повторний імпорт не створює нових заявок. Конфлікти версій не перезаписуються автоматично.
- requested_amount відрізняється від award_amount; порожня сума залишається невідомою. Різні валюти не порівнювати як одну суму без окремого погодженого правила.
- `client_no` — послідовний, але **не** використовується для зв'язків; `LockService` при видачі.
- `edrpou_optional` — довільний рядок з окремою перевіркою формату для української юрособи, не обов'язковий для фізособи.
- `official_url` — лише HTTPS, збереження нормалізованого URL для перевірки дублів.
- `deadline_at` і `due_at` не повинні втрачати часовий пояс.
- Дати й суми не підміняти вигаданими значеннями; невідоме = порожнє поле.

## Реалізоване розширення CRM 1.2

Чинний контракт і ручна міграція: [V1_2_FIRST_RELEASE.md](V1_2_FIRST_RELEASE.md). Старі повні ISO з поясом збережено; календарні поля також приймають `YYYY-MM-DD` без часу. Службові `created_at`, `updated_at`, `deleted_at` лишаються ISO-мітками.

- `applications.official_url` — необов’язкове HTTPS-посилання конкурсу, у JSON заявки.
- `documents`: id, version, client_id, application_id?, client_partner_id?, title, category, url, document_date?, expiry_at?, note, created_at, updated_at, deleted_at?. Зберігаються лише метадані; файл та його права залишаються в Drive. Це уточнення першого випуску документів замість майбутнього прямого керування file_id/folder_id.
- `partners`: id, version, name, type, geography, sector, contacts, notes, created_at, updated_at. Спільний довідник.
- `client_partners`: id, version, client_id, partner_id, role, status, start_date, comments, memorandum (boolean), memorandum_date, memorandum_expiry, memorandum_document_id, support_letter (boolean), support_date, support_document_id, created_at, updated_at, deleted_at?. Один активний зв’язок на пару UUID.

Усі три нові проєкції використовують колонки `id`, `client_id`, `version`, `data_json`; у партнера client_id порожній. Пов’язані заявки, партнерства та документи належать тому самому клієнту. М’яке видалення зберігає історичні зв’язки. `schema:2` у керівній комірці блокує стару збірку; `modelVersion:12` у знімку визначає нові колекції. Нові аркуші створює лише приватний ручний `migrateCrm12_` після незалежної копії; автоматичного оновлення робочої бази немає.

## CRM 1.3 — каталог клієнтів

Необов’язкові властивості JSON `clients.data_json`: `social_links` (масив `{platform,url,label}`; відсутність читається як порожній список), `nonprofit_code` (порожнє або рядок із чотирьох цифр), `registration_date` (YYYY-MM-DD, не майбутня), `catalog_note` (рядок до 2000 символів). `PROFILE` не змінюється: нові поля залишаються у JSON клієнта; старі профілі й невідомі властивості зберігаються. Аркуші, заголовки, журнал, `modelVersion:12`, `schema:2` та OAuth незмінні. Міграція з 1.2 не потрібна; її резервні копії приймаються.

Нові типи: `territorial_community`, `state_institution`, `institute`, `communal_institution`. Наявні типи не перекласифіковуються.

Обчислювані поля не записуються в Sheets:
- `submitted_count`: невидалені заявки з валідним `submission_at` (дата або ISO з поясом) АБО статусом `submitted`, `won`, `rejected`; `stopped` лише з датою подання.
- `won_count`: невидалені заявки зі статусом `won`, незалежно від суми. Це виграні гранти, **не надходження коштів**. Обидва лічильники включають архів.
- `organization_age`: повні роки від державної реєстрації за поточною датою Europe/Kyiv; річниця 29 лютого в невисокосному році — 1 березня. Для фізособи, відсутньої, майбутньої або невалідної дати — null (`—`); при обох напрямках сортування пропуски останні.

Соцмережі використовують спільний HTTPS-валідатор `normalizeUrl`; перегляд екранує текст і відкриває посилання з `noopener noreferrer`. Примітка оновлюється частковим `saveClient` із обов’язковими полями та версією, через чинний RPC із ревізією/ідемпотентним requestId. Чернетки приміток зберігаються в пам’яті вкладки під час фільтрації, пагінації та помилок; перезавантаження сторінки їх не зберігає. Конфлікт не перезаписує чужі зміни: текст можна скопіювати перед оновленням.
