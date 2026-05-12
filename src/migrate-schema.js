import 'dotenv/config';
import { pool, query } from './db.js';

async function columnExists(table, column) {
  const rows = await query(
    `SELECT 1 FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
    [table, column]
  );
  return rows.length > 0;
}

async function addColumn(table, column, def) {
  if (!(await columnExists(table, column))) {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${def}`);
  }
}

async function indexExists(table, name) {
  const rows = await query(
    `SELECT 1 FROM information_schema.statistics
      WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1`,
    [table, name]
  );
  return rows.length > 0;
}

async function addIndex(table, name, columns, unique = false) {
  if (!(await indexExists(table, name))) {
    await query(`CREATE ${unique ? 'UNIQUE ' : ''}INDEX ${name} ON ${table} (${columns})`);
  }
}

async function migrate() {
  // ===== users (extend existing table) =====
  await addColumn('users', 'name', 'VARCHAR(64) NULL');
  await addColumn('users', 'birthdate', 'DATE NULL');
  await addColumn('users', 'age_range', 'VARCHAR(16) NULL');
  await addColumn('users', 'show_real_name_to_matches', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'is_demo', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'demo_welcome_message', 'TEXT NULL');
  await addColumn('users', 'gender', `ENUM('male','female','other','prefer_not') NULL`);
  await addColumn('users', 'bio', 'TEXT NULL');
  await addColumn('users', 'mbti', 'VARCHAR(4) NULL');
  await addColumn('users', 'residence', 'VARCHAR(128) NULL');
  await addColumn('users', 'job', 'VARCHAR(64) NULL');
  await addColumn('users', 'company', 'VARCHAR(128) NULL');
  await addColumn('users', 'university', 'VARCHAR(128) NULL');
  await addColumn('users', 'avatar_style', 'VARCHAR(32) NULL');
  await addColumn('users', 'avatar_seed', 'VARCHAR(64) NULL');
  await addColumn('users', 'phone', 'VARCHAR(32) NULL');
  await addColumn('users', 'phone_verified', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumn('users', 'xp_total', 'INT NOT NULL DEFAULT 0');
  await addColumn('users', 'level', 'INT NOT NULL DEFAULT 1');
  await addColumn('users', 'status', `ENUM('active','suspended','deleted') NOT NULL DEFAULT 'active'`);
  await addColumn('users', 'suspended_at', 'DATETIME NULL');
  await addColumn('users', 'suspended_until', 'DATETIME NULL');
  await addColumn('users', 'suspended_reason', 'VARCHAR(255) NULL');
  await addColumn('users', 'deleted_at', 'DATETIME NULL');
  await addColumn('users', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP');
  await addIndex('users', 'idx_users_status', 'status');
  await addIndex('users', 'idx_users_phone', 'phone');

  // ===== user_identities (multi-SNS) =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_identities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      provider VARCHAR(32) NOT NULL,
      provider_user_id VARCHAR(128) NOT NULL,
      email VARCHAR(255) NULL,
      raw_payload JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_provider_id (provider, provider_user_id),
      KEY idx_user (user_id),
      CONSTRAINT fk_ui_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  // Backfill existing users.kakao_id -> user_identities
  if (await columnExists('users', 'kakao_id')) {
    await query(`
      INSERT IGNORE INTO user_identities (user_id, provider, provider_user_id)
      SELECT id, 'kakao', CAST(kakao_id AS CHAR) FROM users WHERE kakao_id IS NOT NULL
    `);
  }

  // ===== phone_otps =====
  await query(`
    CREATE TABLE IF NOT EXISTS phone_otps (
      id INT AUTO_INCREMENT PRIMARY KEY,
      phone VARCHAR(32) NOT NULL,
      code_hash VARCHAR(255) NOT NULL,
      expires_at DATETIME NOT NULL,
      consumed TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_phone (phone),
      KEY idx_expires (expires_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== verification_domains =====
  await query(`
    CREATE TABLE IF NOT EXISTS verification_domains (
      id INT AUTO_INCREMENT PRIMARY KEY,
      type ENUM('school','company') NOT NULL,
      domain VARCHAR(128) NOT NULL,
      label VARCHAR(128) NOT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_domain (domain)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== email_verifications =====
  await query(`
    CREATE TABLE IF NOT EXISTS email_verifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type ENUM('school','company') NOT NULL,
      email VARCHAR(255) NOT NULL,
      domain VARCHAR(128) NOT NULL,
      code_hash VARCHAR(255) NULL,
      status ENUM('pending','verified','expired','revoked') NOT NULL DEFAULT 'pending',
      verified_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user (user_id),
      KEY idx_status (status),
      CONSTRAINT fk_ev_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== interest_tags =====
  await query(`
    CREATE TABLE IF NOT EXISTS interest_tags (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(64) NOT NULL UNIQUE,
      category VARCHAR(32) NULL,
      display_order INT NOT NULL DEFAULT 0,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_interests =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_interests (
      user_id BIGINT UNSIGNED NOT NULL,
      tag_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, tag_id),
      CONSTRAINT fk_uin_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_uin_tag FOREIGN KEY (tag_id) REFERENCES interest_tags(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_photos =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_photos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      url VARCHAR(512) NOT NULL,
      position TINYINT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_pos (user_id, position),
      CONSTRAINT fk_up_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_bucket_countries =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_bucket_countries (
      user_id BIGINT UNSIGNED NOT NULL,
      country_id INT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, country_id),
      CONSTRAINT fk_ubc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== trust_components =====
  await query(`
    CREATE TABLE IF NOT EXISTS trust_components (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type ENUM('referral','identity','review','community','school','company') NOT NULL,
      points DECIMAL(4,1) NOT NULL DEFAULT 0,
      detail JSON NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_user_type (user_id, type),
      CONSTRAINT fk_tc_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== matches =====
  await query(`
    CREATE TABLE IF NOT EXISTS matches (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_a_id BIGINT UNSIGNED NOT NULL,
      user_b_id BIGINT UNSIGNED NOT NULL,
      status ENUM('pending','accepted','declined','expired','closed') NOT NULL DEFAULT 'pending',
      compatibility DECIMAL(4,1) NULL,
      requested_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      responded_at DATETIME NULL,
      closed_at DATETIME NULL,
      KEY idx_a (user_a_id),
      KEY idx_b (user_b_id),
      KEY idx_status (status),
      CONSTRAINT fk_match_a FOREIGN KEY (user_a_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_match_b FOREIGN KEY (user_b_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== chat_rooms =====
  await query(`
    CREATE TABLE IF NOT EXISTS chat_rooms (
      id INT AUTO_INCREMENT PRIMARY KEY,
      match_id INT NULL,
      type ENUM('match','group') NOT NULL DEFAULT 'match',
      char_limit INT NOT NULL DEFAULT 200,
      daily_cap INT NOT NULL DEFAULT 50,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closed_at DATETIME NULL,
      KEY idx_match (match_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== chat_room_members =====
  await query(`
    CREATE TABLE IF NOT EXISTS chat_room_members (
      room_id INT NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_read_at DATETIME NULL,
      PRIMARY KEY (room_id, user_id),
      CONSTRAINT fk_crm_room FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE,
      CONSTRAINT fk_crm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== chat_messages =====
  await query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      room_id INT NOT NULL,
      sender_id BIGINT UNSIGNED NULL,
      type ENUM('text','system','image') NOT NULL DEFAULT 'text',
      body TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      deleted_at DATETIME NULL,
      KEY idx_room_time (room_id, created_at),
      CONSTRAINT fk_cm_room FOREIGN KEY (room_id) REFERENCES chat_rooms(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== trips =====
  await query(`
    CREATE TABLE IF NOT EXISTS trips (
      id INT AUTO_INCREMENT PRIMARY KEY,
      owner_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(128) NOT NULL,
      destination_country_id INT NULL,
      destination_label VARCHAR(128) NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      budget INT NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'KRW',
      status ENUM('draft','active','completed','cancelled') NOT NULL DEFAULT 'draft',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      KEY idx_owner (owner_id),
      KEY idx_status (status),
      CONSTRAINT fk_trips_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== trip_members =====
  await query(`
    CREATE TABLE IF NOT EXISTS trip_members (
      trip_id INT NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      role ENUM('owner','member') NOT NULL DEFAULT 'member',
      joined_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (trip_id, user_id),
      CONSTRAINT fk_tm_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      CONSTRAINT fk_tm_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== trip_activities =====
  await query(`
    CREATE TABLE IF NOT EXISTS trip_activities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      day_index TINYINT NOT NULL,
      start_time TIME NULL,
      duration_min INT NULL,
      place_name VARCHAR(128) NOT NULL,
      category VARCHAR(32) NULL,
      cost INT NULL,
      currency VARCHAR(8) NULL,
      status ENUM('pending','confirmed','conflicted','cancelled') NOT NULL DEFAULT 'pending',
      proposed_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_trip_day (trip_id, day_index),
      CONSTRAINT fk_ta_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== trip_activity_votes =====
  await query(`
    CREATE TABLE IF NOT EXISTS trip_activity_votes (
      activity_id INT NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      choice VARCHAR(32) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (activity_id, user_id),
      CONSTRAINT fk_tav_act FOREIGN KEY (activity_id) REFERENCES trip_activities(id) ON DELETE CASCADE,
      CONSTRAINT fk_tav_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== expense_items =====
  await query(`
    CREATE TABLE IF NOT EXISTS expense_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      trip_id INT NOT NULL,
      name VARCHAR(128) NOT NULL,
      amount DECIMAL(12,2) NOT NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'KRW',
      paid_by BIGINT UNSIGNED NOT NULL,
      split_method ENUM('equal','custom') NOT NULL DEFAULT 'equal',
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_trip (trip_id),
      CONSTRAINT fk_ei_trip FOREIGN KEY (trip_id) REFERENCES trips(id) ON DELETE CASCADE,
      CONSTRAINT fk_ei_user FOREIGN KEY (paid_by) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== expense_shares =====
  await query(`
    CREATE TABLE IF NOT EXISTS expense_shares (
      item_id INT NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      share_amount DECIMAL(12,2) NOT NULL,
      PRIMARY KEY (item_id, user_id),
      CONSTRAINT fk_es_item FOREIGN KEY (item_id) REFERENCES expense_items(id) ON DELETE CASCADE,
      CONSTRAINT fk_es_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== community_posts =====
  await query(`
    CREATE TABLE IF NOT EXISTS community_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      author_id BIGINT UNSIGNED NOT NULL,
      title VARCHAR(255) NULL,
      body TEXT NOT NULL,
      country_id INT NULL,
      like_count INT NOT NULL DEFAULT 0,
      comment_count INT NOT NULL DEFAULT 0,
      status ENUM('published','hidden','deleted') NOT NULL DEFAULT 'published',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_author (author_id),
      KEY idx_status (status),
      CONSTRAINT fk_cp_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== community_comments =====
  await query(`
    CREATE TABLE IF NOT EXISTS community_comments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      post_id INT NOT NULL,
      author_id BIGINT UNSIGNED NOT NULL,
      body TEXT NOT NULL,
      status ENUM('published','hidden','deleted') NOT NULL DEFAULT 'published',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_post (post_id),
      CONSTRAINT fk_cc_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_cc_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== community_likes =====
  await query(`
    CREATE TABLE IF NOT EXISTS community_likes (
      post_id INT NOT NULL,
      user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (post_id, user_id),
      CONSTRAINT fk_cl_post FOREIGN KEY (post_id) REFERENCES community_posts(id) ON DELETE CASCADE,
      CONSTRAINT fk_cl_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== group_posts =====
  await query(`
    CREATE TABLE IF NOT EXISTS group_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      author_id BIGINT UNSIGNED NOT NULL,
      group_type ENUM('school','company','friend','family','solo') NOT NULL,
      title VARCHAR(255) NOT NULL,
      destination_country_id INT NULL,
      destination_label VARCHAR(128) NULL,
      start_date DATE NULL,
      end_date DATE NULL,
      size_min INT NULL,
      size_max INT NULL,
      budget INT NULL,
      currency VARCHAR(8) NOT NULL DEFAULT 'KRW',
      description TEXT NULL,
      status ENUM('open','closed','hidden','deleted') NOT NULL DEFAULT 'open',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_author (author_id),
      KEY idx_type (group_type),
      KEY idx_status (status),
      CONSTRAINT fk_gp_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== xp_events =====
  await query(`
    CREATE TABLE IF NOT EXISTS xp_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      event_type VARCHAR(32) NOT NULL,
      points INT NOT NULL,
      ref_type VARCHAR(32) NULL,
      ref_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_time (user_id, created_at),
      CONSTRAINT fk_xpe_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== daily_missions =====
  await query(`
    CREATE TABLE IF NOT EXISTS daily_missions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      title VARCHAR(128) NOT NULL,
      points INT NOT NULL DEFAULT 0,
      goal INT NOT NULL DEFAULT 1,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      display_order INT NOT NULL DEFAULT 0
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== daily_mission_logs =====
  await query(`
    CREATE TABLE IF NOT EXISTS daily_mission_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      mission_id INT NOT NULL,
      progress INT NOT NULL DEFAULT 0,
      completed TINYINT(1) NOT NULL DEFAULT 0,
      day_key DATE NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uniq_dml (user_id, mission_id, day_key),
      CONSTRAINT fk_dml_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_dml_mission FOREIGN KEY (mission_id) REFERENCES daily_missions(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== badges =====
  await query(`
    CREATE TABLE IF NOT EXISTS badges (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(64) NOT NULL UNIQUE,
      name VARCHAR(128) NOT NULL,
      description TEXT NULL,
      country_id INT NULL,
      enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_badges =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_badges (
      user_id BIGINT UNSIGNED NOT NULL,
      badge_id INT NOT NULL,
      earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, badge_id),
      CONSTRAINT fk_ub_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_ub_badge FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== notifications =====
  await query(`
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type VARCHAR(64) NOT NULL,
      title VARCHAR(255) NULL,
      body TEXT NULL,
      payload JSON NULL,
      read_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_time (user_id, created_at),
      KEY idx_read (read_at),
      CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== reports =====
  await query(`
    CREATE TABLE IF NOT EXISTS reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      reporter_id BIGINT UNSIGNED NULL,
      target_type ENUM('user','message','post','comment','group_post','trip') NOT NULL,
      target_id INT NOT NULL,
      reason VARCHAR(64) NOT NULL,
      detail TEXT NULL,
      status ENUM('open','reviewing','resolved','dismissed') NOT NULL DEFAULT 'open',
      resolution TEXT NULL,
      resolved_by INT NULL,
      resolved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_status (status),
      KEY idx_target (target_type, target_id),
      KEY idx_reporter (reporter_id),
      CONSTRAINT fk_reports_reporter FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_blocks =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_blocks (
      user_id BIGINT UNSIGNED NOT NULL,
      blocked_user_id BIGINT UNSIGNED NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, blocked_user_id),
      CONSTRAINT fk_blk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      CONSTRAINT fk_blk_blocked FOREIGN KEY (blocked_user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_sanctions =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_sanctions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      type ENUM('warn','suspend','ban') NOT NULL,
      reason VARCHAR(255) NOT NULL,
      detail TEXT NULL,
      starts_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at DATETIME NULL,
      issued_by INT NULL,
      revoked_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user (user_id),
      KEY idx_active (revoked_at, ends_at),
      CONSTRAINT fk_us_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== user_agreements =====
  await query(`
    CREATE TABLE IF NOT EXISTS user_agreements (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id BIGINT UNSIGNED NOT NULL,
      agreement_code VARCHAR(64) NOT NULL,
      version VARCHAR(16) NOT NULL,
      agreed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_user_code (user_id, agreement_code),
      CONSTRAINT fk_ua_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  // ===== admin_audit_logs =====
  await query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      admin_id INT NULL,
      action VARCHAR(64) NOT NULL,
      target_type VARCHAR(64) NULL,
      target_id VARCHAR(64) NULL,
      payload JSON NULL,
      ip VARCHAR(64) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      KEY idx_admin_time (admin_id, created_at),
      KEY idx_action (action)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `);

  console.log('schema migration complete.');
  await pool.end();
}

migrate().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
