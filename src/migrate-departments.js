import 'dotenv/config';
import { pool, query } from './db.js';

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS departments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE,
      display_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const seeds = [
    ['경영', 1],
    ['R&D', 2],
    ['마케팅', 3],
    ['영업', 4],
  ];
  for (const [name, order] of seeds) {
    await query(
      'INSERT INTO departments (name, display_order) VALUES (?, ?) ON DUPLICATE KEY UPDATE display_order = VALUES(display_order)',
      [name, order]
    );
  }
  console.log('departments migration complete.');
  await pool.end();
}

migrate().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
