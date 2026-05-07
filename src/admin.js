import { Router } from 'express';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const ALLOWED_PAGES = [
  'dashboard',
  'members',
  'reports',
  'interests',
  'verification',
  'departments',
  'admins',
  'audit',
];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const original = Buffer.from(hash, 'hex');
  if (candidate.length !== original.length) return false;
  return crypto.timingSafeEqual(candidate, original);
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length > 0) return fwd.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || '';
}

function publicAdmin(row) {
  if (!row) return null;
  let pages = [];
  if (row.accessible_pages) {
    try {
      pages = typeof row.accessible_pages === 'string'
        ? JSON.parse(row.accessible_pages)
        : row.accessible_pages;
    } catch {
      pages = [];
    }
  }
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    name: row.name,
    department: row.department,
    accessiblePages: pages,
    mustChangePassword: !!row.must_change_password,
    lastLoginAt: row.last_login_at,
    lastLoginIp: row.last_login_ip,
    lastLogoutAt: row.last_logout_at,
    lastLogoutIp: row.last_logout_ip,
    createdAt: row.created_at,
  };
}

function requireAdmin(req, res, next) {
  if (!req.session?.adminId) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
  next();
}

function requireSupervisor(req, res, next) {
  if (req.session?.adminRole !== 'supervisor') {
    return res.status(403).json({ ok: false, error: '최고관리자 권한이 필요합니다.' });
  }
  next();
}

async function isValidDepartment(name) {
  if (!name) return true;
  const rows = await query('SELECT id FROM departments WHERE name = ?', [name]);
  return rows.length > 0;
}

function normalizePages(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const p of input) {
    const v = String(p || '').trim();
    if (!v) continue;
    if (v === '*' || ALLOWED_PAGES.includes(v)) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

router.get('/admin', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
});

router.post('/admin/api/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ ok: false, error: '아이디와 비밀번호를 입력하세요.' });
  }
  const rows = await query('SELECT * FROM admins WHERE username = ?', [String(username)]);
  const admin = rows[0];
  if (!admin || !verifyPassword(String(password), admin.password_hash)) {
    return res.status(401).json({ ok: false, error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }

  const previousLogout = {
    lastLogoutAt: admin.last_logout_at,
    lastLogoutIp: admin.last_logout_ip,
  };

  const ip = getClientIp(req);
  await query(
    'UPDATE admins SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?',
    [ip, admin.id]
  );

  req.session.adminId = admin.id;
  req.session.adminRole = admin.role;
  req.session.save(() => {
    res.json({
      ok: true,
      admin: publicAdmin({ ...admin, last_login_at: new Date(), last_login_ip: ip }),
      previousLogout,
    });
  });
});

router.post('/admin/api/logout', requireAdmin, async (req, res) => {
  const ip = getClientIp(req);
  await query(
    'UPDATE admins SET last_logout_at = NOW(), last_logout_ip = ? WHERE id = ?',
    [ip, req.session.adminId]
  );
  req.session.destroy(() => {
    res.clearCookie('mate.sid');
    res.json({ ok: true });
  });
});

router.get('/admin/api/me', requireAdmin, async (req, res) => {
  const rows = await query('SELECT * FROM admins WHERE id = ?', [req.session.adminId]);
  if (!rows[0]) {
    req.session.destroy(() => {});
    return res.status(401).json({ ok: false, error: '계정을 찾을 수 없습니다.' });
  }
  res.json({ ok: true, admin: publicAdmin(rows[0]) });
});

router.post('/admin/api/change-password', requireAdmin, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(400).json({ ok: false, error: '새 비밀번호는 8자 이상이어야 합니다.' });
  }
  const rows = await query('SELECT * FROM admins WHERE id = ?', [req.session.adminId]);
  const admin = rows[0];
  if (!admin) return res.status(401).json({ ok: false, error: '계정을 찾을 수 없습니다.' });

  if (!admin.must_change_password) {
    if (!currentPassword || !verifyPassword(String(currentPassword), admin.password_hash)) {
      return res.status(400).json({ ok: false, error: '현재 비밀번호가 올바르지 않습니다.' });
    }
  }
  if (verifyPassword(String(newPassword), admin.password_hash)) {
    return res.status(400).json({ ok: false, error: '기존 비밀번호와 다른 비밀번호로 설정하세요.' });
  }

  await query(
    'UPDATE admins SET password_hash = ?, must_change_password = 0 WHERE id = ?',
    [hashPassword(String(newPassword)), admin.id]
  );
  res.json({ ok: true });
});

router.get('/admin/api/sub-admins', requireAdmin, requireSupervisor, async (_req, res) => {
  const rows = await query(
    `SELECT * FROM admins WHERE role = 'sub' ORDER BY created_at DESC`
  );
  res.json({ ok: true, admins: rows.map(publicAdmin) });
});

router.post('/admin/api/sub-admins', requireAdmin, requireSupervisor, async (req, res) => {
  const { username, password, name, department, accessiblePages } = req.body || {};
  const u = String(username || '').trim();
  const p = String(password || '');
  const n = String(name || '').trim();
  const d = String(department || '').trim();
  if (!u || !p || !n) {
    return res.status(400).json({ ok: false, error: '아이디, 비밀번호, 이름은 필수입니다.' });
  }
  if (u.length < 3 || u.length > 64) {
    return res.status(400).json({ ok: false, error: '아이디는 3~64자여야 합니다.' });
  }
  if (p.length < 8) {
    return res.status(400).json({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' });
  }
  if (!(await isValidDepartment(d))) {
    return res.status(400).json({ ok: false, error: '유효하지 않은 부서입니다.' });
  }
  const pages = normalizePages(accessiblePages);

  const dup = await query('SELECT id FROM admins WHERE username = ?', [u]);
  if (dup.length > 0) {
    return res.status(409).json({ ok: false, error: '이미 사용 중인 아이디입니다.' });
  }

  const result = await query(
    `INSERT INTO admins (username, password_hash, role, name, department, accessible_pages, must_change_password, created_by)
     VALUES (?, ?, 'sub', ?, ?, ?, 1, ?)`,
    [u, hashPassword(p), n, d, JSON.stringify(pages), req.session.adminId]
  );
  const rows = await query('SELECT * FROM admins WHERE id = ?', [result.insertId]);
  res.status(201).json({ ok: true, admin: publicAdmin(rows[0]) });
});

router.put('/admin/api/sub-admins/:id', requireAdmin, requireSupervisor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: '잘못된 요청입니다.' });
  }
  const rows = await query(`SELECT * FROM admins WHERE id = ? AND role = 'sub'`, [id]);
  if (!rows[0]) return res.status(404).json({ ok: false, error: '대상 관리자를 찾을 수 없습니다.' });

  const { name, department, accessiblePages, password } = req.body || {};
  const updates = [];
  const params = [];
  if (typeof name === 'string') {
    updates.push('name = ?');
    params.push(name.trim());
  }
  if (typeof department === 'string') {
    const dept = department.trim();
    if (!(await isValidDepartment(dept))) {
      return res.status(400).json({ ok: false, error: '유효하지 않은 부서입니다.' });
    }
    updates.push('department = ?');
    params.push(dept);
  }
  if (Array.isArray(accessiblePages)) {
    updates.push('accessible_pages = ?');
    params.push(JSON.stringify(normalizePages(accessiblePages)));
  }
  if (typeof password === 'string' && password.length > 0) {
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: '비밀번호는 8자 이상이어야 합니다.' });
    }
    updates.push('password_hash = ?');
    params.push(hashPassword(password));
    updates.push('must_change_password = 1');
  }
  if (updates.length === 0) {
    return res.status(400).json({ ok: false, error: '변경할 내용이 없습니다.' });
  }
  params.push(id);
  await query(`UPDATE admins SET ${updates.join(', ')} WHERE id = ?`, params);
  const updated = await query('SELECT * FROM admins WHERE id = ?', [id]);
  res.json({ ok: true, admin: publicAdmin(updated[0]) });
});

router.delete('/admin/api/sub-admins/:id', requireAdmin, requireSupervisor, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ ok: false, error: '잘못된 요청입니다.' });
  }
  const result = await query(`DELETE FROM admins WHERE id = ? AND role = 'sub'`, [id]);
  if (result.affectedRows === 0) {
    return res.status(404).json({ ok: false, error: '대상 관리자를 찾을 수 없습니다.' });
  }
  res.json({ ok: true });
});

router.get('/admin/api/pages', requireAdmin, (_req, res) => {
  res.json({ ok: true, pages: ALLOWED_PAGES });
});

router.get('/admin/api/departments', requireAdmin, async (_req, res) => {
  const rows = await query(
    'SELECT id, name FROM departments ORDER BY display_order, name'
  );
  res.json({ ok: true, departments: rows });
});

// =====================================================================
// Audit log helper
// =====================================================================
async function logAdminAction(req, action, targetType, targetId, payload) {
  try {
    await query(
      `INSERT INTO admin_audit_logs (admin_id, action, target_type, target_id, payload, ip)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.session?.adminId || null,
        action,
        targetType || null,
        targetId == null ? null : String(targetId),
        payload ? JSON.stringify(payload) : null,
        getClientIp(req),
      ]
    );
  } catch (e) {
    console.error('audit log failed', e);
  }
}

function checkPage(page) {
  return (req, res, next) => {
    if (req.session?.adminRole === 'supervisor') return next();
    const adminId = req.session?.adminId;
    if (!adminId) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
    query('SELECT accessible_pages FROM admins WHERE id = ?', [adminId])
      .then((rows) => {
        let pages = [];
        try {
          pages = rows[0]?.accessible_pages
            ? typeof rows[0].accessible_pages === 'string'
              ? JSON.parse(rows[0].accessible_pages)
              : rows[0].accessible_pages
            : [];
        } catch {
          pages = [];
        }
        if (pages.includes('*') || pages.includes(page)) return next();
        res.status(403).json({ ok: false, error: '접근 권한이 없습니다.' });
      })
      .catch(next);
  };
}

// =====================================================================
// Members (사용자 관리)
// =====================================================================
router.get('/admin/api/members', requireAdmin, checkPage('members'), async (req, res) => {
  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  if (q) {
    where.push('(u.nickname LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR ui.provider_user_id LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like, like);
  }
  if (status && ['active', 'suspended', 'deleted'].includes(status)) {
    where.push('u.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // 본명(name)은 정책상 노출하지 않음.
  const rows = await query(
    `SELECT SQL_CALC_FOUND_ROWS u.id, u.nickname, u.email, u.phone, u.status,
            u.created_at, u.last_login_at, u.suspended_until,
            (SELECT GROUP_CONCAT(DISTINCT provider) FROM user_identities WHERE user_id = u.id) AS providers
       FROM users u
       LEFT JOIN user_identities ui ON ui.user_id = u.id
       ${whereSql}
       GROUP BY u.id
       ORDER BY u.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRows = await query('SELECT FOUND_ROWS() AS total');
  res.json({
    ok: true,
    members: rows.map((r) => ({ ...r, providers: r.providers ? r.providers.split(',') : [] })),
    page,
    limit,
    total: totalRows[0]?.total || 0,
  });
});

router.get('/admin/api/members/:id', requireAdmin, checkPage('members'), async (req, res) => {
  const id = req.params.id;
  const rows = await query(
    `SELECT id, nickname, email, phone, phone_verified, gender, age_range, birthdate, bio, mbti,
            residence, job, company, university, avatar_style, xp_total, level, status,
            suspended_at, suspended_until, suspended_reason, last_login_at, created_at
       FROM users WHERE id = ?`,
    [id]
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
  const identities = await query(
    'SELECT id, provider, provider_user_id, email, created_at FROM user_identities WHERE user_id = ? ORDER BY id',
    [id]
  );
  const sanctions = await query(
    `SELECT id, type, reason, detail, starts_at, ends_at, revoked_at, issued_by, created_at
       FROM user_sanctions WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
    [id]
  );
  res.json({ ok: true, member: rows[0], identities, sanctions });
});

router.post('/admin/api/members/:id/suspend', requireAdmin, checkPage('members'), async (req, res) => {
  const id = req.params.id;
  const reason = String(req.body?.reason || '').trim();
  const days = Math.max(0, parseInt(req.body?.days, 10) || 0);
  if (!reason) return res.status(400).json({ ok: false, error: '사유를 입력하세요.' });
  const exists = await query('SELECT id FROM users WHERE id = ?', [id]);
  if (!exists[0]) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });

  const ends = days > 0
    ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')
    : null;
  await query(
    'UPDATE users SET status = ?, suspended_at = NOW(), suspended_until = ?, suspended_reason = ? WHERE id = ?',
    ['suspended', ends, reason, id]
  );
  await query(
    'INSERT INTO user_sanctions (user_id, type, reason, starts_at, ends_at, issued_by) VALUES (?, ?, ?, NOW(), ?, ?)',
    [id, 'suspend', reason, ends, req.session.adminId]
  );
  await logAdminAction(req, 'member.suspend', 'user', id, { reason, days });
  res.json({ ok: true });
});

router.post('/admin/api/members/:id/unsuspend', requireAdmin, checkPage('members'), async (req, res) => {
  const id = req.params.id;
  await query(
    'UPDATE users SET status = ?, suspended_until = NULL, suspended_reason = NULL WHERE id = ?',
    ['active', id]
  );
  await query(
    'UPDATE user_sanctions SET revoked_at = NOW() WHERE user_id = ? AND type IN (?,?) AND revoked_at IS NULL',
    [id, 'suspend', 'ban']
  );
  await logAdminAction(req, 'member.unsuspend', 'user', id, null);
  res.json({ ok: true });
});

router.post('/admin/api/members/:id/ban', requireAdmin, checkPage('members'), async (req, res) => {
  const id = req.params.id;
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ ok: false, error: '사유를 입력하세요.' });
  const exists = await query('SELECT id FROM users WHERE id = ?', [id]);
  if (!exists[0]) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
  await query(
    'UPDATE users SET status = ?, suspended_at = NOW(), suspended_until = NULL, suspended_reason = ? WHERE id = ?',
    ['suspended', reason, id]
  );
  await query(
    'INSERT INTO user_sanctions (user_id, type, reason, starts_at, ends_at, issued_by) VALUES (?, ?, ?, NOW(), NULL, ?)',
    [id, 'ban', reason, req.session.adminId]
  );
  await logAdminAction(req, 'member.ban', 'user', id, { reason });
  res.json({ ok: true });
});

// =====================================================================
// Reports (신고 처리)
// =====================================================================
router.get('/admin/api/reports', requireAdmin, checkPage('reports'), async (req, res) => {
  const status = String(req.query.status || '').trim();
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 20, 1), 100);
  const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
  const offset = (page - 1) * limit;

  const where = [];
  const params = [];
  if (status && ['open', 'reviewing', 'resolved', 'dismissed'].includes(status)) {
    where.push('r.status = ?');
    params.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rows = await query(
    `SELECT SQL_CALC_FOUND_ROWS r.id, r.reporter_id, r.target_type, r.target_id, r.reason,
            r.status, r.created_at, r.resolved_at,
            ru.nickname AS reporter_nickname
       FROM reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
       ${whereSql}
       ORDER BY r.id DESC
       LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const totalRows = await query('SELECT FOUND_ROWS() AS total');
  res.json({ ok: true, reports: rows, page, limit, total: totalRows[0]?.total || 0 });
});

router.get('/admin/api/reports/:id', requireAdmin, checkPage('reports'), async (req, res) => {
  const rows = await query(
    `SELECT r.*, ru.nickname AS reporter_nickname
       FROM reports r
       LEFT JOIN users ru ON ru.id = r.reporter_id
      WHERE r.id = ?`,
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: '신고를 찾을 수 없습니다.' });
  res.json({ ok: true, report: rows[0] });
});

router.post('/admin/api/reports/:id/resolve', requireAdmin, checkPage('reports'), async (req, res) => {
  const id = req.params.id;
  const { resolution, action, sanctionDays } = req.body || {};
  const resStatus =
    action === 'dismiss' ? 'dismissed' :
    action === 'reviewing' ? 'reviewing' : 'resolved';

  const rows = await query('SELECT * FROM reports WHERE id = ?', [id]);
  if (!rows[0]) return res.status(404).json({ ok: false, error: '신고를 찾을 수 없습니다.' });
  const report = rows[0];

  if ((action === 'warn' || action === 'suspend' || action === 'ban') && report.target_type === 'user') {
    const targetId = report.target_id;
    if (action === 'warn') {
      await query(
        'INSERT INTO user_sanctions (user_id, type, reason, starts_at, ends_at, issued_by) VALUES (?, ?, ?, NOW(), NULL, ?)',
        [targetId, 'warn', String(resolution || '신고 처리').slice(0, 200), req.session.adminId]
      );
    } else if (action === 'suspend') {
      const days = Math.max(1, parseInt(sanctionDays, 10) || 7);
      const ends = new Date(Date.now() + days * 86400000).toISOString().slice(0, 19).replace('T', ' ');
      await query(
        'UPDATE users SET status = ?, suspended_at = NOW(), suspended_until = ?, suspended_reason = ? WHERE id = ?',
        ['suspended', ends, String(resolution || '신고 처리').slice(0, 200), targetId]
      );
      await query(
        'INSERT INTO user_sanctions (user_id, type, reason, starts_at, ends_at, issued_by) VALUES (?, ?, ?, NOW(), ?, ?)',
        [targetId, 'suspend', String(resolution || '신고 처리').slice(0, 200), ends, req.session.adminId]
      );
    } else if (action === 'ban') {
      await query(
        'UPDATE users SET status = ?, suspended_at = NOW(), suspended_until = NULL, suspended_reason = ? WHERE id = ?',
        ['suspended', String(resolution || '신고 처리').slice(0, 200), targetId]
      );
      await query(
        'INSERT INTO user_sanctions (user_id, type, reason, starts_at, ends_at, issued_by) VALUES (?, ?, ?, NOW(), NULL, ?)',
        [targetId, 'ban', String(resolution || '신고 처리').slice(0, 200), req.session.adminId]
      );
    }
  }

  await query(
    'UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = NOW() WHERE id = ?',
    [resStatus, resolution || null, req.session.adminId, id]
  );
  await logAdminAction(req, 'report.resolve', 'report', id, { action, sanctionDays });
  res.json({ ok: true });
});

// =====================================================================
// Master data: interest_tags
// =====================================================================
router.get('/admin/api/master/interest-tags', requireAdmin, checkPage('interests'), async (_req, res) => {
  const rows = await query(
    'SELECT id, name, category, display_order, enabled FROM interest_tags ORDER BY display_order, name'
  );
  res.json({ ok: true, tags: rows });
});

router.post('/admin/api/master/interest-tags', requireAdmin, checkPage('interests'), async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const category = String(req.body?.category || '').trim() || null;
  const displayOrder = parseInt(req.body?.displayOrder, 10) || 0;
  const enabled = req.body?.enabled === false ? 0 : 1;
  if (!name) return res.status(400).json({ ok: false, error: '이름을 입력하세요.' });
  try {
    const r = await query(
      'INSERT INTO interest_tags (name, category, display_order, enabled) VALUES (?, ?, ?, ?)',
      [name, category, displayOrder, enabled]
    );
    await logAdminAction(req, 'interest.create', 'interest_tag', r.insertId, { name, category });
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: '이미 존재하는 태그입니다.' });
    throw e;
  }
});

router.put('/admin/api/master/interest-tags/:id', requireAdmin, checkPage('interests'), async (req, res) => {
  const id = req.params.id;
  const updates = [];
  const params = [];
  if (typeof req.body?.name === 'string') { updates.push('name = ?'); params.push(req.body.name.trim()); }
  if (typeof req.body?.category === 'string') { updates.push('category = ?'); params.push(req.body.category.trim() || null); }
  if (req.body?.displayOrder != null) { updates.push('display_order = ?'); params.push(parseInt(req.body.displayOrder, 10) || 0); }
  if (typeof req.body?.enabled === 'boolean') { updates.push('enabled = ?'); params.push(req.body.enabled ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ ok: false, error: '변경할 내용이 없습니다.' });
  params.push(id);
  await query(`UPDATE interest_tags SET ${updates.join(', ')} WHERE id = ?`, params);
  await logAdminAction(req, 'interest.update', 'interest_tag', id, req.body);
  res.json({ ok: true });
});

router.delete('/admin/api/master/interest-tags/:id', requireAdmin, checkPage('interests'), async (req, res) => {
  const r = await query('DELETE FROM interest_tags WHERE id = ?', [req.params.id]);
  if (r.affectedRows === 0) return res.status(404).json({ ok: false, error: '대상을 찾을 수 없습니다.' });
  await logAdminAction(req, 'interest.delete', 'interest_tag', req.params.id, null);
  res.json({ ok: true });
});

// =====================================================================
// Master data: verification_domains
// =====================================================================
router.get('/admin/api/master/verification-domains', requireAdmin, checkPage('verification'), async (_req, res) => {
  const rows = await query(
    'SELECT id, type, domain, label, enabled FROM verification_domains ORDER BY type, domain'
  );
  res.json({ ok: true, domains: rows });
});

router.post('/admin/api/master/verification-domains', requireAdmin, checkPage('verification'), async (req, res) => {
  const type = String(req.body?.type || '').trim();
  const domain = String(req.body?.domain || '').trim().toLowerCase();
  const label = String(req.body?.label || '').trim();
  const enabled = req.body?.enabled === false ? 0 : 1;
  if (!['school', 'company'].includes(type)) return res.status(400).json({ ok: false, error: '유형이 올바르지 않습니다.' });
  if (!domain || !label) return res.status(400).json({ ok: false, error: '도메인과 라벨은 필수입니다.' });
  try {
    const r = await query(
      'INSERT INTO verification_domains (type, domain, label, enabled) VALUES (?, ?, ?, ?)',
      [type, domain, label, enabled]
    );
    await logAdminAction(req, 'verification.create', 'verification_domain', r.insertId, { type, domain, label });
    res.status(201).json({ ok: true, id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ ok: false, error: '이미 등록된 도메인입니다.' });
    throw e;
  }
});

router.put('/admin/api/master/verification-domains/:id', requireAdmin, checkPage('verification'), async (req, res) => {
  const id = req.params.id;
  const updates = [];
  const params = [];
  if (typeof req.body?.type === 'string' && ['school', 'company'].includes(req.body.type)) {
    updates.push('type = ?'); params.push(req.body.type);
  }
  if (typeof req.body?.domain === 'string') { updates.push('domain = ?'); params.push(req.body.domain.trim().toLowerCase()); }
  if (typeof req.body?.label === 'string') { updates.push('label = ?'); params.push(req.body.label.trim()); }
  if (typeof req.body?.enabled === 'boolean') { updates.push('enabled = ?'); params.push(req.body.enabled ? 1 : 0); }
  if (updates.length === 0) return res.status(400).json({ ok: false, error: '변경할 내용이 없습니다.' });
  params.push(id);
  await query(`UPDATE verification_domains SET ${updates.join(', ')} WHERE id = ?`, params);
  await logAdminAction(req, 'verification.update', 'verification_domain', id, req.body);
  res.json({ ok: true });
});

router.delete('/admin/api/master/verification-domains/:id', requireAdmin, checkPage('verification'), async (req, res) => {
  const r = await query('DELETE FROM verification_domains WHERE id = ?', [req.params.id]);
  if (r.affectedRows === 0) return res.status(404).json({ ok: false, error: '대상을 찾을 수 없습니다.' });
  await logAdminAction(req, 'verification.delete', 'verification_domain', req.params.id, null);
  res.json({ ok: true });
});

// =====================================================================
// Dashboard (stats)
// =====================================================================
router.get('/admin/api/dashboard', requireAdmin, async (_req, res) => {
  const [u] = await query(`SELECT
      COUNT(*) AS total,
      SUM(status='active') AS active,
      SUM(status='suspended') AS suspended,
      SUM(status='deleted') AS deleted
    FROM users`);
  const [r] = await query(`SELECT
      SUM(status='open') AS open_reports,
      SUM(status='reviewing') AS reviewing_reports,
      SUM(status='resolved') AS resolved_reports
    FROM reports`);
  const [a] = await query(`SELECT COUNT(*) AS sub_admins FROM admins WHERE role='sub'`);
  const [t] = await query(`SELECT COUNT(*) AS total_trips FROM trips`);
  res.json({
    ok: true,
    users: u,
    reports: r,
    sub_admins: a.sub_admins,
    trips: t.total_trips,
  });
});

export default router;
