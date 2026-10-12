# Модель даних (Google Sheets)

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
| `applications` | id, client_id, grant_id, title, status, submission_at, award_amount, currency, donor_reply_at, notes, created_at, updated_at | Один клієнт → кілька заявок |
| `documents` | id, client_id, application_id, drive_file_id, drive_folder_id, doc_type, doc_status, expiry_at, uploaded_at, checked_at, note | Вміст файлів — лише Google Drive |
| `services_invoices` | id, client_id, service_name, agreement_drive_file_id, currency, amount, prepayment, paid, due_at, status, note | Управлінський фіноблік |
| `calendar_links` | id, entity_type, entity_id, calendar_id, event_id, payload_hash, last_synced_at, sync_status, error_message | Один зв'язок на сутність; unique(entity_type,entity_id) |
| `ai_ledger` | id, used_at, provider, model, action, input_hash, input_tokens_est, output_tokens_est, status, error_code | Без текстів клієнтських документів |
| `audit_log` | id, entity_type, entity_id, action, actor, occurred_at, changes_summary | Не логувати секрети |
| `settings` | key, value_json, updated_at | Без ключів і токенів; секрети в Script Properties |

### Файлова структура Google Drive
`CRM_Клієнти/0001_Назва/01_Реєстрація; 02_Політики; 03_Досвід; 04_Фінанси; 05_Заявки; 06_Договори; 07_Листування/`. Структуру створювати лише для активованого досьє. Назва папки може змінюватися, але `drive_folder_id` незмінний.

### Валідація
- `client_no` — послідовний, але **не** використовується для зв'язків; `LockService` при видачі.
- `edrpou_optional` — довільний рядок з окремою перевіркою формату для української юрособи, не обов'язковий для фізособи.
- `official_url` — лише HTTPS, збереження нормалізованого URL для перевірки дублів.
- `deadline_at` і `due_at` не повинні втрачати часовий пояс.
- Дати й суми не підміняти вигаданими значеннями; невідоме = порожнє поле.
