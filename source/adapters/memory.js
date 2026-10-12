'use strict';
const tables = ['clients', 'client_profiles', 'contacts', 'interactions', 'tasks', 'grants', 'matches', 'applications', 'documents', 'services_invoices', 'calendar_links', 'ai_ledger', 'audit_log', 'settings'];
const clone = value => structuredClone(value);
// Контракт сховища: initialize, list, put. Усі операції лише в пам’яті.
class MemoryStorage {
  constructor() { this.data = Object.fromEntries(tables.map(name => [name, []])); }
  list(table) { if (!tables.includes(table)) throw new Error('Невідома таблиця.'); return clone(this.data[table]); }
  put(table, row) {
    const rows = this.list(table);
    const key = table === 'settings' ? 'key' : 'id';
    if (typeof row[key] !== 'string' || !row[key]) throw new Error('Потрібен стабільний ключ.');
    const index = rows.findIndex(item => item[key] === row[key]);
    if (index < 0) rows.push(clone(row)); else rows[index] = clone(row);
    this.data[table] = rows;
  }
  initialize(seed = {}) {
    const staged = new MemoryStorage();
    staged.data = clone(this.data);
    for (const [table, rows] of Object.entries(seed)) {
      for (const row of rows) {
        const key = table === 'settings' ? 'key' : 'id';
        if (!staged.list(table).some(item => item[key] === row[key])) staged.put(table, row);
      }
    }
    this.data = staged.data;
  }
  // Лише тестовий знімок адаптера; продуктивні бекапи належать М4.
  snapshot() { return JSON.stringify({ version: 1, tables: this.data }); }
  restore(snapshot) {
    const parsed = JSON.parse(snapshot);
    if (parsed.version !== 1 || !parsed.tables || Object.keys(parsed.tables).length !== tables.length) throw new Error('Некоректний знімок.');
    const staged = new MemoryStorage();
    for (const table of tables) {
      const rows = parsed.tables[table];
      if (!Array.isArray(rows)) throw new Error('Некоректна таблиця.');
      for (const row of rows) staged.put(table, row);
      if (staged.list(table).length !== rows.length) throw new Error('Дублікати ключів.');
    }
    this.data = staged.data;
  }
}
// Контракт календаря: upsert(syncKey, payload), cancel(syncKey). Google не підключений.
class MemoryCalendar {
  constructor() { this.events = new Map(); this.sequence = 0; }
  upsert(key, payload) {
    if (!key) throw new Error('Потрібен ключ синхронізації.');
    const event = { id: this.events.get(key)?.id || `demo-event-${++this.sequence}`, payload: clone(payload) };
    this.events.set(key, event);
    return clone(event);
  }
  cancel(key) { return this.events.delete(key); }
}
class DisabledGoogleAdapter {
  execute() { throw new Error('Інтеграції Google вимкнені у М1.'); }
}
module.exports = { tables, MemoryStorage, MemoryCalendar, DisabledGoogleAdapter };
