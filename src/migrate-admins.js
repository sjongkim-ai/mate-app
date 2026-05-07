import 'dotenv/config';
import crypto from 'node:crypto';
import { pool, query } from './db.js';

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS admins (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(64) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('supervisor','sub') NOT NULL DEFAULT 'sub',
      name VARCHAR(64) NOT NULL DEFAULT '',
      department VARCHAR(64) NOT NULL DEFAULT '',
      accessible_pages JSON NULL,
      must_change_password TINYINT(1) NOT NULL DEFAULT 0,
      last_login_at DATETIME NULL,
      last_login_ip VARCHAR(64) NULL,
      last_logout_at DATETIME NULL,
      last_logout_ip VARCHAR(64) NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const existing = await query('SELECT id FROM admins WHERE username = ?', ['supervisor']);
  if (existing.length === 0) {
    await query(
      `INSERT INTO admins (username, password_hash, role, name, department, accessible_pages, must_change_password)
       VALUES (?, ?, 'supervisor', ?, ?, ?, 0)`,
      ['supervisor', hashPassword('!Q2w3e4r'), '최고관리자', '관리부', JSON.stringify(['*'])]
    );
    console.log('Seeded supervisor account (id: supervisor).');
  } else {
    console.log('Supervisor already exists; skipping seed.');
  }

  console.log('admins migration complete.');
  await pool.end();
}

migrate().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
