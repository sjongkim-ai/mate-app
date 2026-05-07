import { Router } from 'express';
import crypto from 'node:crypto';
import { upsertKakaoUser, getUserById } from './users.js';

const router = Router();

// Kakao OAuth 동의 항목.
// 본명(name)은 정책상 수집/저장하지 않음.
// 검수 신청 전 임시: 검수 불필요한 기본 항목만 요청.
// 검수 통과 후 'account_email','gender','age_range' 를 다시 추가할 것.
const KAKAO_SCOPES = [
  'profile_nickname',
  'profile_image',
].join(',');

router.get('/auth/kakao', (req, res) => {
  if (!process.env.KAKAO_REST_API_KEY) {
    return res
      .status(500)
      .send('KAKAO_REST_API_KEY is not configured. Set it in .env and restart the server.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.kakaoOAuthState = state;
  const url = new URL('https://kauth.kakao.com/oauth/authorize');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.KAKAO_REST_API_KEY);
  url.searchParams.set('redirect_uri', process.env.KAKAO_REDIRECT_URI);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', KAKAO_SCOPES);
  res.redirect(url.toString());
});

router.get('/auth/kakao/callback', async (req, res, next) => {
  try {
    const { code, state, error, error_description } = req.query;
    if (error) {
      return res.status(400).send(`Kakao OAuth error: ${error_description || error}`);
    }
    if (!code) return res.status(400).send('Missing authorization code');
    if (!state || state !== req.session.kakaoOAuthState) {
      return res.status(400).send('Invalid state (possible CSRF)');
    }
    delete req.session.kakaoOAuthState;

    const tokenBody = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: process.env.KAKAO_REST_API_KEY,
      redirect_uri: process.env.KAKAO_REDIRECT_URI,
      code: String(code),
    });
    if (process.env.KAKAO_CLIENT_SECRET) {
      tokenBody.set('client_secret', process.env.KAKAO_CLIENT_SECRET);
    }
    const tokenResp = await fetch('https://kauth.kakao.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: tokenBody,
    });
    if (!tokenResp.ok) {
      throw new Error(`Token exchange failed: ${tokenResp.status} ${await tokenResp.text()}`);
    }
    const { access_token } = await tokenResp.json();

    const userResp = await fetch('https://kapi.kakao.com/v2/user/me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userResp.ok) {
      throw new Error(`User info failed: ${userResp.status} ${await userResp.text()}`);
    }
    const ku = await userResp.json();
    const ka = ku.kakao_account || {};
    const profile = ka.profile || {};

    // 동의 거부한 항목은 _needs_agreement: true 가 되고 값이 안 옴 → null 저장.
    // gender 값은 카카오에서 'male' | 'female' 로 옴 (DB enum과 호환).
    // 본명(name)은 정책상 수집하지 않음.
    const gender = ka.gender_needs_agreement === false ? (ka.gender || null) : null;
    const ageRange = ka.age_range_needs_agreement === false ? (ka.age_range || null) : null;

    const user = await upsertKakaoUser({
      kakaoId: ku.id,
      email: ka.email || null,
      nickname: profile.nickname || null,
      profileImageUrl: profile.profile_image_url || null,
      thumbnailImageUrl: profile.thumbnail_image_url || null,
      gender,
      ageRange,
    });

    req.session.userId = user.id;
    req.session.save(() => res.redirect('/'));
  } catch (e) {
    next(e);
  }
});

router.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

router.get('/api/me', async (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const user = await getUserById(req.session.userId);
  res.json({ user });
});

export default router;
