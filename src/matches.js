import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
  next();
}

function parsePayload(p) {
  if (!p) return null;
  if (typeof p !== 'string') return p;
  try {
    return JSON.parse(p);
  } catch {
    return null;
  }
}

async function getDisplayName(userId) {
  const rows = await query('SELECT id, nickname FROM users WHERE id = ?', [userId]);
  if (!rows[0]) return `유저 #${userId}`;
  return rows[0].nickname || `유저 #${userId}`;
}

router.get('/matches', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'matches.html'));
});

// ============ 사용자 프로필 카드 (다른 사용자 보기) ============
// 게스트(비로그인) 사용자도 조회 가능. 차단 검사·매칭 상태는 로그인 시에만 적용.
router.get('/api/me/users/:id/profile', async (req, res) => {
  const me = req.session?.userId || null;
  const targetId = Number(req.params.id);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ ok: false, error: '잘못된 사용자 ID 입니다.' });
  }

  if (me) {
    const blocked = await query(
      `SELECT 1 FROM user_blocks
         WHERE (user_id = ? AND blocked_user_id = ?)
            OR (user_id = ? AND blocked_user_id = ?) LIMIT 1`,
      [me, targetId, targetId, me]
    );
    if (blocked[0]) return res.status(403).json({ ok: false, error: '조회할 수 없는 사용자입니다.' });
  }

  // 본명·이메일·전화 등 민감 정보는 절대 노출하지 않음.
  const userRows = await query(
    `SELECT id, nickname, profile_image_url, thumbnail_image_url, bio,
            mbti, residence, age_range, gender, status, created_at, last_login_at,
            xp_total, level
       FROM users WHERE id = ?`,
    [targetId]
  );
  if (!userRows[0]) return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });
  const u = userRows[0];
  if (u.status !== 'active') return res.status(404).json({ ok: false, error: '사용자를 찾을 수 없습니다.' });

  const prefRows = await query(
    `SELECT explorer, aesthetic, planner, spontaneous, persona_type, tags, destinations, summary
       FROM user_preference_profile WHERE user_id = ?`,
    [targetId]
  );
  const parseJson = (v) => {
    if (!v) return [];
    try { return typeof v === 'string' ? JSON.parse(v) : v; } catch { return []; }
  };
  const preference = prefRows[0]
    ? {
        axes: {
          explorer: prefRows[0].explorer,
          aesthetic: prefRows[0].aesthetic,
          planner: prefRows[0].planner,
          spontaneous: prefRows[0].spontaneous,
        },
        personaType: prefRows[0].persona_type,
        tags: parseJson(prefRows[0].tags),
        destinations: parseJson(prefRows[0].destinations),
        summary: prefRows[0].summary,
      }
    : null;

  const interestRows = await query(
    `SELECT it.name FROM user_interests ui
       JOIN interest_tags it ON it.id = ui.tag_id
      WHERE ui.user_id = ? ORDER BY it.display_order, it.name`,
    [targetId]
  );
  const interests = interestRows.map((r) => r.name);

  let match = null;
  if (me) {
    const ua = Math.min(Number(me), targetId);
    const ub = Math.max(Number(me), targetId);
    const matchRows = await query(
      `SELECT id, status, requested_by, created_at, responded_at
         FROM matches WHERE user_a_id = ? AND user_b_id = ? ORDER BY id DESC LIMIT 1`,
      [ua, ub]
    );
    match = matchRows[0] || null;
  }

  res.json({
    ok: true,
    guest: !me,
    user: {
      id: u.id,
      nickname: u.nickname,
      profile_image_url: u.profile_image_url,
      thumbnail_image_url: u.thumbnail_image_url,
      bio: u.bio,
      mbti: u.mbti,
      residence: u.residence,
      age_range: u.age_range,
      gender: u.gender,
      level: u.level,
      xp_total: u.xp_total,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    },
    preference,
    interests,
    match,
  });
});

// ============ Discover (다른 사용자 목록) ============
// 게스트(비로그인) 사용자도 조회 가능. 본명(name)은 노출 금지 정책.
router.get('/api/me/discover', async (req, res) => {
  const me = req.session?.userId || null;
  const q = String(req.query.q || '').trim();
  const where = [`u.status = 'active'`];
  const params = [];
  if (me) { where.push('u.id != ?'); params.push(me); }
  if (q) {
    where.push('u.nickname LIKE ?');
    params.push(`%${q}%`);
  }
  const baseSelect = `u.id, u.nickname, u.bio, u.profile_image_url, u.thumbnail_image_url,
                      u.mbti, u.residence, u.age_range, u.gender`;

  if (me) {
    const rows = await query(
      `SELECT ${baseSelect},
              (SELECT m.status FROM matches m
                WHERE m.user_a_id = LEAST(?, u.id) AND m.user_b_id = GREATEST(?, u.id)
                ORDER BY m.id DESC LIMIT 1) AS match_status,
              (SELECT m.requested_by FROM matches m
                WHERE m.user_a_id = LEAST(?, u.id) AND m.user_b_id = GREATEST(?, u.id)
                ORDER BY m.id DESC LIMIT 1) AS match_requested_by
         FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY u.last_login_at DESC, u.id DESC
        LIMIT 50`,
      [me, me, me, me, ...params]
    );
    res.json({ ok: true, users: rows, guest: false });
  } else {
    const rows = await query(
      `SELECT ${baseSelect}
         FROM users u
        WHERE ${where.join(' AND ')}
        ORDER BY u.last_login_at DESC, u.id DESC
        LIMIT 50`,
      params
    );
    res.json({ ok: true, users: rows, guest: true });
  }
});

// ============ 매칭 요청 ============
router.post('/api/me/matches/request', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const targetId = Number(req.body?.targetUserId);
  const message = String(req.body?.message || '').slice(0, 200);
  if (!Number.isInteger(targetId) || targetId <= 0) {
    return res.status(400).json({ ok: false, error: 'targetUserId가 올바르지 않습니다.' });
  }
  if (Number(targetId) === Number(me)) {
    return res.status(400).json({ ok: false, error: '자기 자신에게는 신청할 수 없습니다.' });
  }

  const target = await query('SELECT id, status, is_demo, demo_welcome_message FROM users WHERE id = ?', [targetId]);
  if (!target[0]) return res.status(404).json({ ok: false, error: '대상 사용자를 찾을 수 없습니다.' });
  if (target[0].status !== 'active') {
    return res.status(400).json({ ok: false, error: '비활성 사용자에게는 신청할 수 없습니다.' });
  }

  const blocked = await query(
    `SELECT 1 FROM user_blocks
       WHERE (user_id = ? AND blocked_user_id = ?)
          OR (user_id = ? AND blocked_user_id = ?) LIMIT 1`,
    [me, targetId, targetId, me]
  );
  if (blocked[0]) return res.status(403).json({ ok: false, error: '차단 관계가 있어 신청할 수 없습니다.' });

  const ua = Math.min(Number(me), targetId);
  const ub = Math.max(Number(me), targetId);

  const existing = await query(
    `SELECT id, status, requested_by FROM matches
      WHERE user_a_id = ? AND user_b_id = ? ORDER BY id DESC LIMIT 1`,
    [ua, ub]
  );
  if (existing[0] && (existing[0].status === 'pending' || existing[0].status === 'accepted')) {
    return res.status(409).json({
      ok: false,
      error: existing[0].status === 'pending' ? '이미 신청된 상태입니다.' : '이미 매칭된 사용자입니다.',
      matchId: existing[0].id,
    });
  }

  const myName = await getDisplayName(me);

  const r = await query(
    `INSERT INTO matches (user_a_id, user_b_id, status, requested_by, created_at)
     VALUES (?, ?, 'pending', ?, NOW())`,
    [ua, ub, me]
  );
  const matchId = r.insertId;

  await query(
    `INSERT INTO notifications (user_id, type, title, body, payload)
     VALUES (?, 'match_request', ?, ?, ?)`,
    [
      targetId,
      `${myName}님이 동반자 신청을 보냈어요`,
      message || '함께 여행을 떠나볼까요?',
      JSON.stringify({ matchId, fromUserId: Number(me), fromName: myName, message }),
    ]
  );

  // 데모 사용자에게 신청한 경우 자동 수락 + 환영 메시지
  if (target[0].is_demo) {
    const autoResult = await autoAcceptByDemo(matchId, targetId, ua, ub, target[0].demo_welcome_message, Number(me));
    return res.status(201).json({
      ok: true,
      matchId,
      autoAccepted: true,
      chatRoomId: autoResult.roomId,
      message: '데모 사용자가 자동으로 수락했어요. 채팅을 시작해 보세요!',
    });
  }

  res.status(201).json({ ok: true, matchId });
});

async function autoAcceptByDemo(matchId, demoUserId, userAId, userBId, welcomeText, requesterId) {
  await query(
    `UPDATE matches SET status = 'accepted', responded_at = NOW() WHERE id = ?`,
    [matchId]
  );

  // 채팅방 생성
  const roomResult = await query(
    `INSERT INTO chat_rooms (match_id, type, char_limit, daily_cap, created_at)
     VALUES (?, 'match', 200, 50, NOW())`,
    [matchId]
  );
  const roomId = roomResult.insertId;
  await query(
    `INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?), (?, ?)`,
    [roomId, userAId, roomId, userBId]
  );

  // 시스템 메시지
  const demoName = await getDisplayName(demoUserId);
  await query(
    `INSERT INTO chat_messages (room_id, sender_id, type, body)
     VALUES (?, NULL, 'system', ?)`,
    [roomId, `${demoName}님이 동반자 신청을 수락했습니다.`]
  );

  // 환영 메시지 (데모 사용자가 보낸 것처럼)
  if (welcomeText) {
    await query(
      `INSERT INTO chat_messages (room_id, sender_id, type, body) VALUES (?, ?, 'text', ?)`,
      [roomId, demoUserId, welcomeText]
    );
  }

  // 신청자(현재 사용자)에게 수락 알림
  await query(
    `INSERT INTO notifications (user_id, type, title, body, payload)
     VALUES (?, 'match_accepted', ?, ?, ?)`,
    [
      requesterId,
      `${demoName}님이 동반자 신청을 수락했어요!`,
      '채팅을 시작해 보세요.',
      JSON.stringify({ matchId, byUserId: demoUserId, byName: demoName, chatRoomId: roomId }),
    ]
  );

  return { roomId };
}

// ============ 매칭 목록 ============
router.get('/api/me/matches', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const direction = String(req.query.direction || '');
  const status = String(req.query.status || '');
  const where = ['(m.user_a_id = ? OR m.user_b_id = ?)'];
  const params = [me, me];
  if (status && ['pending', 'accepted', 'declined', 'expired', 'closed'].includes(status)) {
    where.push('m.status = ?'); params.push(status);
  }
  if (direction === 'incoming') { where.push('m.requested_by != ?'); params.push(me); }
  if (direction === 'outgoing') { where.push('m.requested_by = ?'); params.push(me); }

  // 본명은 어디에서도 노출하지 않음. nickname만 사용.
  const rows = await query(
    `SELECT m.id, m.status, m.compatibility, m.requested_by, m.created_at, m.responded_at,
            CASE WHEN m.user_a_id = ? THEN m.user_b_id ELSE m.user_a_id END AS other_user_id,
            other_u.nickname AS other_nickname,
            other_u.bio AS other_bio, other_u.mbti AS other_mbti,
            other_u.residence AS other_residence,
            other_u.age_range AS other_age_range,
            other_u.gender AS other_gender,
            other_u.profile_image_url AS other_profile,
            other_u.thumbnail_image_url AS other_thumbnail,
            (SELECT room.id FROM chat_rooms room WHERE room.match_id = m.id LIMIT 1) AS chat_room_id
       FROM matches m
       JOIN users other_u
         ON other_u.id = CASE WHEN m.user_a_id = ? THEN m.user_b_id ELSE m.user_a_id END
      WHERE ${where.join(' AND ')}
      ORDER BY m.id DESC`,
    [me, me, ...params]
  );
  res.json({
    ok: true,
    matches: rows.map((r) => ({
      ...r,
      direction: Number(r.requested_by) === Number(me) ? 'outgoing' : 'incoming',
    })),
  });
});

// ============ 매칭 승인 ============
router.post('/api/me/matches/:id/accept', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM matches WHERE id = ?', [id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ ok: false, error: '매칭을 찾을 수 없습니다.' });
  if (Number(m.user_a_id) !== Number(me) && Number(m.user_b_id) !== Number(me)) {
    return res.status(403).json({ ok: false, error: '권한이 없습니다.' });
  }
  if (Number(m.requested_by) === Number(me)) {
    return res.status(400).json({ ok: false, error: '본인이 보낸 신청은 승인할 수 없습니다.' });
  }
  if (m.status !== 'pending') {
    return res.status(409).json({ ok: false, error: `현재 상태(${m.status})에서는 승인할 수 없습니다.` });
  }

  await query(`UPDATE matches SET status='accepted', responded_at=NOW() WHERE id = ?`, [id]);

  const existingRoom = await query('SELECT id FROM chat_rooms WHERE match_id = ?', [id]);
  let roomId = existingRoom[0]?.id;
  if (!roomId) {
    const r = await query(
      `INSERT INTO chat_rooms (match_id, type, char_limit, daily_cap, created_at)
       VALUES (?, 'match', 200, 50, NOW())`,
      [id]
    );
    roomId = r.insertId;
    await query(
      `INSERT INTO chat_room_members (room_id, user_id) VALUES (?, ?), (?, ?)`,
      [roomId, m.user_a_id, roomId, m.user_b_id]
    );
    const myName = await getDisplayName(me);
    await query(
      `INSERT INTO chat_messages (room_id, sender_id, type, body)
       VALUES (?, NULL, 'system', ?)`,
      [roomId, `${myName}님이 동반자 신청을 수락했습니다. 채팅을 시작해 보세요.`]
    );
  }

  const myName = await getDisplayName(me);
  await query(
    `INSERT INTO notifications (user_id, type, title, body, payload)
     VALUES (?, 'match_accepted', ?, ?, ?)`,
    [
      m.requested_by,
      `${myName}님이 동반자 신청을 수락했어요!`,
      '이제 채팅을 시작할 수 있어요.',
      JSON.stringify({ matchId: id, byUserId: Number(me), byName: myName, chatRoomId: roomId }),
    ]
  );

  res.json({ ok: true, chatRoomId: roomId });
});

// ============ 매칭 거절 ============
router.post('/api/me/matches/:id/decline', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM matches WHERE id = ?', [id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ ok: false, error: '매칭을 찾을 수 없습니다.' });
  if (Number(m.user_a_id) !== Number(me) && Number(m.user_b_id) !== Number(me)) {
    return res.status(403).json({ ok: false, error: '권한이 없습니다.' });
  }
  if (Number(m.requested_by) === Number(me)) {
    return res.status(400).json({ ok: false, error: '본인이 보낸 신청은 거절할 수 없습니다.' });
  }
  if (m.status !== 'pending') {
    return res.status(409).json({ ok: false, error: `현재 상태(${m.status})에서는 거절할 수 없습니다.` });
  }

  await query(`UPDATE matches SET status='declined', responded_at=NOW() WHERE id = ?`, [id]);

  const myName = await getDisplayName(me);
  await query(
    `INSERT INTO notifications (user_id, type, title, body, payload)
     VALUES (?, 'match_declined', ?, ?, ?)`,
    [
      m.requested_by,
      `${myName}님이 동반자 신청을 정중히 거절했어요`,
      '',
      JSON.stringify({ matchId: id, byUserId: Number(me), byName: myName }),
    ]
  );

  res.json({ ok: true });
});

// ============ 매칭 취소 (요청자만, pending일 때) ============
router.post('/api/me/matches/:id/cancel', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const id = Number(req.params.id);
  const rows = await query('SELECT * FROM matches WHERE id = ?', [id]);
  const m = rows[0];
  if (!m) return res.status(404).json({ ok: false, error: '매칭을 찾을 수 없습니다.' });
  if (Number(m.requested_by) !== Number(me)) {
    return res.status(403).json({ ok: false, error: '본인이 보낸 신청만 취소할 수 있습니다.' });
  }
  if (m.status !== 'pending') {
    return res.status(409).json({ ok: false, error: '대기 중인 신청만 취소할 수 있습니다.' });
  }
  await query(`UPDATE matches SET status='closed', closed_at=NOW() WHERE id = ?`, [id]);
  res.json({ ok: true });
});

// ============ 알림 ============
router.get('/api/me/notifications', requireAuth, async (req, res) => {
  const unreadOnly = req.query.unread_only === 'true';
  const limit = Math.min(parseInt(req.query.limit, 10) || 30, 100);
  const where = ['user_id = ?'];
  const params = [req.session.userId];
  if (unreadOnly) where.push('read_at IS NULL');
  const rows = await query(
    `SELECT id, type, title, body, payload, read_at, created_at
       FROM notifications WHERE ${where.join(' AND ')}
       ORDER BY id DESC LIMIT ?`,
    [...params, limit]
  );
  res.json({
    ok: true,
    notifications: rows.map((r) => ({ ...r, payload: parsePayload(r.payload) })),
  });
});

router.get('/api/me/notifications/unread-count', requireAuth, async (req, res) => {
  const r = await query(
    `SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [req.session.userId]
  );
  res.json({ ok: true, count: r[0]?.c || 0 });
});

router.post('/api/me/notifications/:id/read', requireAuth, async (req, res) => {
  await query(
    `UPDATE notifications SET read_at = NOW()
      WHERE id = ? AND user_id = ? AND read_at IS NULL`,
    [req.params.id, req.session.userId]
  );
  res.json({ ok: true });
});

router.post('/api/me/notifications/read-all', requireAuth, async (req, res) => {
  await query(
    `UPDATE notifications SET read_at = NOW()
      WHERE user_id = ? AND read_at IS NULL`,
    [req.session.userId]
  );
  res.json({ ok: true });
});

export default router;
