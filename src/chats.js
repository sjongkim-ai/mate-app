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

const DEMO_AUTO_REPLIES = [
  '오 좋네요!',
  '저도 그래요 ☺',
  '재밌겠어요',
  '음음, 한번 가보고 싶네요',
  '같이 알아볼까요?',
  '좀 더 자세히 얘기해주실래요?',
  '와 진짜요?',
  '저는 그쪽 잘 몰라서 추천 부탁드려요!',
  '일정은 언제쯤 생각하세요?',
  '예산은 대략 어떻게 잡으셨어요?',
  '좋아요, 같이 가요',
  '😊👍',
  '오 그렇구나',
  '한 번 검색해볼게요',
  '넵 천천히 얘기해봐요',
];

function pickReply() {
  return DEMO_AUTO_REPLIES[Math.floor(Math.random() * DEMO_AUTO_REPLIES.length)];
}

router.get('/chat', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'chat.html'));
});

// 채팅방 목록
router.get('/api/me/chats', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const rows = await query(
    `SELECT r.id AS room_id, r.match_id, r.type, r.char_limit, r.daily_cap, r.closed_at,
            other.id AS other_user_id,
            other.nickname AS other_nickname,
            other.profile_image_url AS other_profile,
            other.thumbnail_image_url AS other_thumbnail,
            other.is_demo AS other_is_demo,
            (SELECT body FROM chat_messages WHERE room_id = r.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) AS last_message,
            (SELECT created_at FROM chat_messages WHERE room_id = r.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) AS last_message_at,
            (SELECT sender_id FROM chat_messages WHERE room_id = r.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) AS last_sender_id,
            (SELECT COUNT(*) FROM chat_messages cm
              WHERE cm.room_id = r.id
                AND cm.sender_id != ?
                AND cm.deleted_at IS NULL
                AND cm.created_at > COALESCE(myMember.last_read_at, '1970-01-01')) AS unread_count
       FROM chat_rooms r
       JOIN chat_room_members myMember ON myMember.room_id = r.id AND myMember.user_id = ?
       LEFT JOIN chat_room_members otherMember ON otherMember.room_id = r.id AND otherMember.user_id != ?
       LEFT JOIN users other ON other.id = otherMember.user_id
      ORDER BY last_message_at DESC, r.id DESC`,
    [me, me, me]
  );
  res.json({ ok: true, rooms: rows });
});

// 채팅방 단일 정보
router.get('/api/me/chats/:roomId', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const roomId = Number(req.params.roomId);
  const member = await query(
    'SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?',
    [roomId, me]
  );
  if (!member[0]) return res.status(403).json({ ok: false, error: '방에 속하지 않습니다.' });

  const rows = await query(
    `SELECT r.id, r.match_id, r.char_limit, r.daily_cap, r.closed_at,
            other.id AS other_user_id, other.nickname AS other_nickname,
            other.profile_image_url AS other_profile, other.thumbnail_image_url AS other_thumbnail,
            other.is_demo AS other_is_demo
       FROM chat_rooms r
       LEFT JOIN chat_room_members om ON om.room_id = r.id AND om.user_id != ?
       LEFT JOIN users other ON other.id = om.user_id
      WHERE r.id = ?`,
    [me, roomId]
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: '방을 찾을 수 없습니다.' });
  res.json({ ok: true, room: rows[0] });
});

// 메시지 조회 (after, before 페이지네이션)
router.get('/api/me/chats/:roomId/messages', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const roomId = Number(req.params.roomId);
  const member = await query(
    'SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?',
    [roomId, me]
  );
  if (!member[0]) return res.status(403).json({ ok: false, error: '방에 속하지 않습니다.' });

  const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
  const after = parseInt(req.query.after, 10);
  const before = parseInt(req.query.before, 10);

  let sql, params;
  if (Number.isFinite(after) && after > 0) {
    sql = `SELECT id, sender_id, type, body, created_at FROM chat_messages
            WHERE room_id = ? AND id > ? AND deleted_at IS NULL
            ORDER BY id ASC LIMIT ?`;
    params = [roomId, after, limit];
  } else if (Number.isFinite(before) && before > 0) {
    sql = `SELECT id, sender_id, type, body, created_at FROM chat_messages
            WHERE room_id = ? AND id < ? AND deleted_at IS NULL
            ORDER BY id DESC LIMIT ?`;
    params = [roomId, before, limit];
  } else {
    sql = `SELECT id, sender_id, type, body, created_at FROM chat_messages
            WHERE room_id = ? AND deleted_at IS NULL
            ORDER BY id DESC LIMIT ?`;
    params = [roomId, limit];
  }
  const rows = await query(sql, params);
  // 최종은 ASC 순으로 반환
  const messages = Number.isFinite(after) && after > 0 ? rows : rows.slice().reverse();
  res.json({ ok: true, messages });
});

// 메시지 전송
router.post('/api/me/chats/:roomId/messages', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const roomId = Number(req.params.roomId);
  const body = String(req.body?.body || '').trim();
  if (!body) return res.status(400).json({ ok: false, error: '내용을 입력하세요.' });

  const room = await query(
    'SELECT char_limit, daily_cap, closed_at FROM chat_rooms WHERE id = ?',
    [roomId]
  );
  if (!room[0]) return res.status(404).json({ ok: false, error: '방을 찾을 수 없습니다.' });
  if (room[0].closed_at) return res.status(409).json({ ok: false, error: '종료된 채팅방입니다.' });
  if (body.length > room[0].char_limit) {
    return res.status(400).json({ ok: false, error: `${room[0].char_limit}자 이내로 입력하세요.` });
  }

  const member = await query(
    'SELECT 1 FROM chat_room_members WHERE room_id = ? AND user_id = ?',
    [roomId, me]
  );
  if (!member[0]) return res.status(403).json({ ok: false, error: '방에 속하지 않습니다.' });

  const todayCount = await query(
    `SELECT COUNT(*) AS c FROM chat_messages
      WHERE room_id = ? AND sender_id = ?
        AND DATE(created_at) = CURDATE()
        AND type = 'text' AND deleted_at IS NULL`,
    [roomId, me]
  );
  if (todayCount[0].c >= room[0].daily_cap) {
    return res.status(429).json({ ok: false, error: `하루 ${room[0].daily_cap}회 메시지 한도를 초과했습니다.` });
  }

  const r = await query(
    'INSERT INTO chat_messages (room_id, sender_id, type, body) VALUES (?, ?, ?, ?)',
    [roomId, me, 'text', body]
  );

  // 상대가 데모 사용자면 자동 답변 (랜덤 1.5~3.5초 후)
  const others = await query(
    `SELECT u.id, u.is_demo FROM chat_room_members crm
       JOIN users u ON u.id = crm.user_id
      WHERE crm.room_id = ? AND crm.user_id != ?`,
    [roomId, me]
  );
  if (others[0]?.is_demo) {
    const replyDelay = 1500 + Math.random() * 2000;
    setTimeout(async () => {
      try {
        await query(
          'INSERT INTO chat_messages (room_id, sender_id, type, body) VALUES (?, ?, ?, ?)',
          [roomId, others[0].id, 'text', pickReply()]
        );
      } catch (e) {
        console.error('demo auto-reply failed', e);
      }
    }, replyDelay);
  }

  const inserted = await query(
    'SELECT id, sender_id, type, body, created_at FROM chat_messages WHERE id = ?',
    [r.insertId]
  );
  res.status(201).json({ ok: true, message: inserted[0] });
});

// 읽음 처리
router.post('/api/me/chats/:roomId/read', requireAuth, async (req, res) => {
  await query(
    'UPDATE chat_room_members SET last_read_at = NOW() WHERE room_id = ? AND user_id = ?',
    [req.params.roomId, req.session.userId]
  );
  res.json({ ok: true });
});

// 미읽음 총합 (배지용)
router.get('/api/me/chats/unread-total', requireAuth, async (req, res) => {
  const me = req.session.userId;
  const r = await query(
    `SELECT COALESCE(SUM(unread), 0) AS total FROM (
        SELECT (SELECT COUNT(*) FROM chat_messages cm
                 WHERE cm.room_id = crm.room_id
                   AND cm.sender_id != ?
                   AND cm.deleted_at IS NULL
                   AND cm.created_at > COALESCE(crm.last_read_at, '1970-01-01')) AS unread
          FROM chat_room_members crm
         WHERE crm.user_id = ?
     ) t`,
    [me, me]
  );
  res.json({ ok: true, total: Number(r[0]?.total || 0) });
});

export default router;
