import { pool, query } from './db.js';

const rows = [
  ['AS', '아시아',     'Asia',          1],
  ['EU', '유럽',       'Europe',        2],
  ['NA', '북아메리카', 'North America', 3],
  ['SA', '남아메리카', 'South America', 4],
  ['OC', '오세아니아', 'Oceania',       5],
  ['AF', '아프리카',   'Africa',        6],
  ['AN', '남극',       'Antarctica',    7],
];

await query('DELETE FROM continents');
for (const [code, ko, en, ord] of rows) {
  await query(
    'INSERT INTO continents (code, name_ko, name_en, sort_order) VALUES (?, ?, ?, ?)',
    [code, ko, en, ord]
  );
}

const result = await query(
  'SELECT code, name_ko, name_en, sort_order FROM continents ORDER BY sort_order'
);
console.table(result);
await pool.end();
