import { query } from './db.js';

// 본명(name)은 정책상 수집·저장·노출하지 않음. 컬럼은 스키마 호환을 위해 남아 있지만
// 어디에서도 읽거나 쓰지 않는다.
export async function upsertKakaoUser({
  kakaoId,
  email,
  nickname,
  profileImageUrl,
  thumbnailImageUrl,
  gender,
  ageRange,
}) {
  // ON DUPLICATE KEY UPDATE에서 COALESCE(기존값, 새값)을 사용해 사용자가 앱 안에서
  // 직접 수정한 값(gender/age_range)은 보존하고, 카카오 응답이 새 값일 때만 채운다.
  await query(
    `INSERT INTO users
       (kakao_id, email, nickname, profile_image_url, thumbnail_image_url,
        gender, age_range, last_login_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       email = VALUES(email),
       nickname = VALUES(nickname),
       profile_image_url = VALUES(profile_image_url),
       thumbnail_image_url = VALUES(thumbnail_image_url),
       gender = COALESCE(gender, VALUES(gender)),
       age_range = COALESCE(age_range, VALUES(age_range)),
       last_login_at = NOW()`,
    [kakaoId, email, nickname, profileImageUrl, thumbnailImageUrl, gender, ageRange]
  );
  const rows = await query(
    `SELECT id, kakao_id, email, nickname, profile_image_url, thumbnail_image_url,
            gender, age_range, birthdate, mbti, residence, bio, status,
            xp_total, level, created_at, last_login_at
       FROM users WHERE kakao_id = ?`,
    [kakaoId]
  );
  return rows[0];
}

export async function getUserById(id) {
  const rows = await query(
    `SELECT id, kakao_id, email, nickname, profile_image_url, thumbnail_image_url,
            gender, age_range, birthdate, mbti, residence, bio, status,
            xp_total, level, created_at, last_login_at
       FROM users WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}
