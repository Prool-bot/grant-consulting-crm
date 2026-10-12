// Усі записи вигадані. Фіксована дата робить демонстрацію відтворюваною.
globalThis.CrmDemo = {
  today: '2026-10-12',
  clients: [
    { id: '00000000-0000-4000-8000-000000000001', client_no: '0001', legal_name: 'ГО «Демо: Простір можливостей»', type: 'ngo', status: 'active', location: 'Умовна громада', sectors: ['Освіта'], contacts: ['Тестова координаторка'], description: 'Вигаданий приклад освітньої ініціативи.' },
    { id: '00000000-0000-4000-8000-000000000002', client_no: '0002', legal_name: 'БФ «Демо: Добра справа»', type: 'foundation', status: 'negotiation', location: 'Тестове місто', sectors: ['Соціальна підтримка'], contacts: [], description: 'Вигаданий приклад благодійного фонду.' },
    { id: '00000000-0000-4000-8000-000000000003', client_no: '0003', legal_name: 'Демо: Учасниця проєкту', type: 'individual', status: 'potential', location: 'Умовна громада', sectors: ['Культура'], contacts: [], description: 'Вигадана фізична особа для перевірки інтерфейсу.' }
  ],
  tasks: [
    { title: 'Уточнити потреби освітнього проєкту', client: 'ГО «Демо: Простір можливостей»', date: '2026-10-12', status: 'in_progress', priority: 'Високий' },
    { title: 'Перевірити чернетку концепції', client: 'БФ «Демо: Добра справа»', date: '2026-10-10', status: 'todo', priority: 'Звичайний' },
    { title: 'Обговорити наступні кроки', client: 'Демо: Учасниця проєкту', date: '2026-10-16', status: 'todo', priority: 'Звичайний' }
  ],
  grants: [
    { title: 'Демо: Освіта поруч', donor: 'Вигаданий освітній фонд', deadline: '2026-10-28', amount: null, sector: 'Освіта', applicants: 'ГО, благодійні фонди' },
    { title: 'Демо: Культурні ініціативи', donor: 'Вигадана програма підтримки', deadline: '2026-11-05', amount: 10000, sector: 'Культура', applicants: 'Фізичні особи, ГО' }
  ]
};
