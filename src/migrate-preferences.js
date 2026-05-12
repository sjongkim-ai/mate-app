import 'dotenv/config';
import { pool, query } from './db.js';

async function migrate() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_external_links (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      platform ENUM('instagram','blog','youtube','threads','twitter','tiktok','other') NOT NULL DEFAULT 'other',
      url VARCHAR(512) NOT NULL,
      handle VARCHAR(128) NULL,
      status ENUM('pending','fetched','failed','forbidden','manual') NOT NULL DEFAULT 'pending',
      fetched_text MEDIUMTEXT NULL,
      fetch_error VARCHAR(255) NULL,
      last_fetched_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_url (user_id, url),
      KEY idx_user (user_id),
      CONSTRAINT fk_uel_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_preference_profile (
      user_id BIGINT UNSIGNED NOT NULL PRIMARY KEY,
      explorer TINYINT UNSIGNED NOT NULL DEFAULT 50,
      aesthetic TINYINT UNSIGNED NOT NULL DEFAULT 50,
      planner TINYINT UNSIGNED NOT NULL DEFAULT 50,
      spontaneous TINYINT UNSIGNED NOT NULL DEFAULT 50,
      persona_type VARCHAR(32) NULL,
      tags JSON NULL,
      destinations JSON NULL,
      summary TEXT NULL,
      source ENUM('ai','user','mixed') NOT NULL DEFAULT 'user',
      last_analyzed_at DATETIME NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_upp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS user_preference_analyses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      snapshot JSON NOT NULL,
      source_summary TEXT NULL,
      model VARCHAR(64) NULL,
      tokens_in INT NULL,
      tokens_out INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_time (user_id, created_at),
      CONSTRAINT fk_upa_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  console.log('preferences migration complete.');
  await pool.end();
}

migrate().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
