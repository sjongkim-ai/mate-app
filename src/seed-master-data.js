import 'dotenv/config';
import { pool, query } from './db.js';

const interestTags = [
  ['감성카페', '음식'],
  ['트레킹', '액티비티'],
  ['현지맛집', '음식'],
  ['미술관', '문화'],
  ['해변', '자연'],
  ['야경', '풍경'],
  ['쇼핑', '도시'],
  ['배낭여행', '스타일'],
  ['럭셔리', '스타일'],
  ['혼행', '스타일'],
  ['역사유적', '문화'],
  ['스파', '휴식'],
  ['축제', '문화'],
  ['캠핑', '액티비티'],
  ['스쿠버', '액티비티'],
];

const verificationDomains = [
  ['school', 'yonsei.ac.kr', '연세대학교'],
  ['school', 'snu.ac.kr', '서울대학교'],
  ['school', 'korea.ac.kr', '고려대학교'],
  ['school', 'kaist.ac.kr', '카이스트'],
  ['school', 'postech.ac.kr', '포스텍'],
  ['company', 'kakao.com', '카카오'],
  ['company', 'naver.com', '네이버'],
  ['company', 'samsung.com', '삼성'],
  ['company', 'hyundai.com', '현대'],
  ['company', 'coupang.com', '쿠팡'],
  ['company', 'krafton.com', '크래프톤'],
  ['company', 'line.me', '라인'],
  ['company', 'lge.com', 'LG'],
  ['company', 'sk.com', 'SK'],
];

const dailyMissions = [
  ['quiz_daily', '여행 퀴즈 풀기', 50, 1],
  ['vote_daily', '여행지 투표 참여', 10, 1],
  ['post_like', '게시글 좋아요 3회', 20, 3],
  ['post_comment', '게시글 댓글 1회', 20, 1],
  ['roulette_spin', '룰렛 돌리기', 20, 1],
  ['profile_visit', '프로필 방문', 10, 1],
];

async function seed() {
  for (let i = 0; i < interestTags.length; i++) {
    const [name, category] = interestTags[i];
    await query(
      'INSERT INTO interest_tags (name, category, display_order) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE category = VALUES(category), display_order = VALUES(display_order)',
      [name, category, i + 1]
    );
  }
  for (const [type, domain, label] of verificationDomains) {
    await query(
      'INSERT INTO verification_domains (type, domain, label) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE label = VALUES(label), type = VALUES(type)',
      [type, domain, label]
    );
  }
  for (let i = 0; i < dailyMissions.length; i++) {
    const [code, title, points, goal] = dailyMissions[i];
    await query(
      'INSERT INTO daily_missions (code, title, points, goal, display_order) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE title = VALUES(title), points = VALUES(points), goal = VALUES(goal), display_order = VALUES(display_order)',
      [code, title, points, goal, i + 1]
    );
  }
  console.log('master data seed complete.');
  await pool.end();
}

seed().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
