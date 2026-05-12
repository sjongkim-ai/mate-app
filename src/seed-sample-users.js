// 데모용 샘플 사용자 시드. 카카오 ID는 실제 ID 범위와 겹치지 않게 큰 마커 값 사용.
import 'dotenv/config';
import { pool, query } from './db.js';

const SAMPLE_USERS = [
  {
    kakao_id: 9000000001,
    nickname: '박지은',
    bio: '교토와 오사카를 사랑하는 일본 여행 마니아 ✈',
    mbti: 'INTJ',
    residence: '서울 강남구',
    gender: 'female',
    age_range: '20~29',
    welcome: '안녕하세요! 매칭 감사해요 😊 어느 도시 가보고 싶으세요?',
    preference: {
      explorer: 50, aesthetic: 80, planner: 85, spontaneous: 25,
      persona_type: 'planner',
      tags: ['감성카페','야경','현지맛집','미술관'],
      destinations: ['교토','오사카','도쿄','후쿠오카'],
      summary: '꼼꼼한 일정으로 일본 도시를 즐기는 계획가형',
    },
    interests: ['감성카페','미술관','야경','현지맛집'],
  },
  {
    kakao_id: 9000000002,
    nickname: '이수아',
    bio: '발리 5번째 방문 예정! 스노쿨링·서핑·야경 좋아함',
    mbti: 'ENFP',
    residence: '서울 마포구',
    gender: 'female',
    age_range: '20~29',
    welcome: '와 매칭 됐네요! 🌊 여행 스타일 잘 맞을 것 같아요. 어디 가고 싶으세요?',
    preference: {
      explorer: 90, aesthetic: 75, planner: 35, spontaneous: 85,
      persona_type: 'explorer',
      tags: ['해변','스쿠버','야경','캠핑'],
      destinations: ['발리','세부','다낭','오키나와'],
      summary: '바다와 자연을 좋아하는 즉흥적인 탐험가',
    },
    interests: ['해변','스쿠버','캠핑','현지맛집'],
  },
  {
    kakao_id: 9000000003,
    nickname: '박준혁',
    bio: '둘레길 마스터, 트레킹 메이트 모집 중',
    mbti: 'ISTJ',
    residence: '서울 서대문구',
    gender: 'male',
    age_range: '20~29',
    welcome: '반가워요. 트레킹이나 둘레길 좋아하시나요? 🏔',
    preference: {
      explorer: 75, aesthetic: 45, planner: 80, spontaneous: 30,
      persona_type: 'planner',
      tags: ['트레킹','캠핑','역사유적'],
      destinations: ['제주','지리산','네팔','페루'],
      summary: '체계적으로 자연을 즐기는 트레킹 계획가',
    },
    interests: ['트레킹','캠핑','역사유적'],
  },
  {
    kakao_id: 9000000004,
    nickname: '이현수',
    bio: '발리·세부·다낭 동남아 여행 전문',
    mbti: 'ESTP',
    residence: '서울 송파구',
    gender: 'male',
    age_range: '30~39',
    welcome: '안녕하세요 🙌 동남아 같이 가실 분 찾고 있었어요!',
    preference: {
      explorer: 80, aesthetic: 55, planner: 50, spontaneous: 75,
      persona_type: 'spontaneous',
      tags: ['해변','현지맛집','쇼핑','스파'],
      destinations: ['발리','세부','다낭','방콕'],
      summary: '동남아 휴양지를 즉흥적으로 즐기는 자유여행자',
    },
    interests: ['해변','현지맛집','스파'],
  },
  {
    kakao_id: 9000000005,
    nickname: '최서연',
    bio: '유럽 배낭여행·미술관·와인 좋아하는 감성 여행자',
    mbti: 'INFJ',
    residence: '경기 성남시',
    gender: 'female',
    age_range: '20~29',
    welcome: '반가워요 ☕ 유럽 도시 같이 가실래요?',
    preference: {
      explorer: 70, aesthetic: 90, planner: 60, spontaneous: 40,
      persona_type: 'aesthetic',
      tags: ['미술관','감성카페','역사유적','야경'],
      destinations: ['파리','피렌체','프라하','리스본'],
      summary: '유럽 미학과 분위기를 즐기는 감성가형',
    },
    interests: ['미술관','감성카페','역사유적','야경'],
  },
  {
    kakao_id: 9000000006,
    nickname: '송하준',
    bio: '도쿄 출장러, 골목골목 잘 압니다',
    mbti: 'INTP',
    residence: '서울 용산구',
    gender: 'male',
    age_range: '30~39',
    welcome: '안녕하세요. 일본 도쿄 자주 다녀서 골목 정보 많이 가지고 있어요 🍜',
    preference: {
      explorer: 60, aesthetic: 70, planner: 75, spontaneous: 50,
      persona_type: 'planner',
      tags: ['현지맛집','감성카페','쇼핑'],
      destinations: ['도쿄','오사카','삿포로','요코하마'],
      summary: '도쿄 골목 맛집을 꿰는 도시형 여행자',
    },
    interests: ['현지맛집','감성카페','쇼핑'],
  },
];

async function getInterestTagId(name) {
  const rows = await query('SELECT id FROM interest_tags WHERE name = ?', [name]);
  return rows[0]?.id || null;
}

async function seed() {
  for (const u of SAMPLE_USERS) {
    await query(
      `INSERT INTO users
         (kakao_id, nickname, bio, mbti, residence, gender, age_range, is_demo, demo_welcome_message, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'active')
       ON DUPLICATE KEY UPDATE
         nickname = VALUES(nickname),
         bio = VALUES(bio),
         mbti = VALUES(mbti),
         residence = VALUES(residence),
         gender = VALUES(gender),
         age_range = VALUES(age_range),
         is_demo = 1,
         demo_welcome_message = VALUES(demo_welcome_message),
         status = 'active'`,
      [u.kakao_id, u.nickname, u.bio, u.mbti, u.residence, u.gender, u.age_range, u.welcome]
    );
    const userRow = await query('SELECT id FROM users WHERE kakao_id = ?', [u.kakao_id]);
    const userId = userRow[0].id;

    const p = u.preference;
    await query(
      `INSERT INTO user_preference_profile
         (user_id, explorer, aesthetic, planner, spontaneous, persona_type, tags, destinations, summary, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai')
       ON DUPLICATE KEY UPDATE
         explorer = VALUES(explorer), aesthetic = VALUES(aesthetic),
         planner = VALUES(planner), spontaneous = VALUES(spontaneous),
         persona_type = VALUES(persona_type),
         tags = VALUES(tags), destinations = VALUES(destinations),
         summary = VALUES(summary), source = 'ai'`,
      [userId, p.explorer, p.aesthetic, p.planner, p.spontaneous, p.persona_type,
       JSON.stringify(p.tags), JSON.stringify(p.destinations), p.summary]
    );

    await query('DELETE FROM user_interests WHERE user_id = ?', [userId]);
    for (const tagName of u.interests) {
      const tagId = await getInterestTagId(tagName);
      if (tagId) {
        await query(
          `INSERT IGNORE INTO user_interests (user_id, tag_id) VALUES (?, ?)`,
          [userId, tagId]
        );
      }
    }
    console.log(`seeded: ${u.nickname} (id=${userId})`);
  }
  console.log(`\n총 ${SAMPLE_USERS.length}명의 샘플 사용자 시드 완료.`);
  await pool.end();
}

seed().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
