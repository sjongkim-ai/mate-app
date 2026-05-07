import { Router } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query } from './db.js';
import { analyzeTravelPreferences } from './llm.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const VALID_PLATFORMS = ['instagram', 'blog', 'youtube', 'threads', 'twitter', 'tiktok', 'other'];

function requireAuth(req, res, next) {
  if (!req.session?.userId) return res.status(401).json({ ok: false, error: '로그인이 필요합니다.' });
  next();
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('blog.naver.com')) return 'blog';
  if (u.includes('.tistory.com')) return 'blog';
  if (u.includes('brunch.co.kr')) return 'blog';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('threads.net')) return 'threads';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  if (u.includes('tiktok.com')) return 'tiktok';
  return 'other';
}

function extractInstagramHandle(url) {
  const m = url.match(/instagram\.com\/([^/?#]+)/i);
  if (!m) return null;
  const h = m[1];
  if (['p', 'reel', 'reels', 'tv', 'stories', 'explore'].includes(h)) return null;
  return h;
}

function extractTextFromHtml(html) {
  const og = {};
  const ogPattern = /<meta\s+(?:[^>]*?\s)?(?:property|name)=["'](og:[^"']+|description|twitter:title|twitter:description)["'][^>]*?content=["']([^"']*)["']/gi;
  const altPattern = /<meta\s+(?:[^>]*?\s)?content=["']([^"']*)["'][^>]*?(?:property|name)=["'](og:[^"']+|description|twitter:title|twitter:description)["']/gi;
  let m;
  while ((m = ogPattern.exec(html)) !== null) og[m[1].toLowerCase()] = m[2];
  while ((m = altPattern.exec(html)) !== null) {
    if (!og[m[2].toLowerCase()]) og[m[2].toLowerCase()] = m[1];
  }
  const titleMatch = /<title[^>]*>([^<]+)<\/title>/i.exec(html);
  const title = (og['og:title'] || og['twitter:title'] || (titleMatch && titleMatch[1]) || '').trim();
  const desc = (og['og:description'] || og['twitter:description'] || og['description'] || '').trim();
  const body = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const parts = [];
  if (title) parts.push(`제목: ${title}`);
  if (desc) parts.push(`설명: ${desc}`);
  if (body) parts.push(body.slice(0, 5000));
  return parts.join('\n\n').slice(0, 6000);
}

async function fetchUrlContent(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ko,en;q=0.8',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);
    if (res.status === 401 || res.status === 403) {
      return { error: 'forbidden', message: `HTTP ${res.status} (로그인 또는 차단)` };
    }
    if (!res.ok) return { error: 'failed', message: `HTTP ${res.status}` };
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('text/plain') && !ct.includes('xml')) {
      return { error: 'failed', message: `지원하지 않는 콘텐츠 타입: ${ct}` };
    }
    const html = await res.text();
    const text = extractTextFromHtml(html);
    if (!text || text.length < 30) {
      return { error: 'failed', message: '본문 추출 실패. 직접 텍스트를 입력하세요.' };
    }
    return { text };
  } catch (e) {
    clearTimeout(timeout);
    if (e.name === 'AbortError') return { error: 'failed', message: '시간 초과 (8초)' };
    return { error: 'failed', message: e.message || String(e) };
  }
}

router.get('/preferences', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'preferences.html'));
});

router.get('/api/me/external-links', requireAuth, async (req, res) => {
  const rows = await query(
    `SELECT id, platform, url, handle, status, fetch_error, last_fetched_at,
            CHAR_LENGTH(fetched_text) AS text_length, created_at
       FROM user_external_links WHERE user_id = ? ORDER BY id DESC`,
    [req.session.userId]
  );
  res.json({ ok: true, links: rows });
});

router.post('/api/me/external-links', requireAuth, async (req, res) => {
  let { url, platform } = req.body || {};
  url = String(url || '').trim();
  if (!url) return res.status(400).json({ ok: false, error: 'URL을 입력하세요.' });
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return res.status(400).json({ ok: false, error: '유효하지 않은 URL입니다.' });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return res.status(400).json({ ok: false, error: 'http(s) URL만 지원합니다.' });
  }

  const detectedPlatform = platform && VALID_PLATFORMS.includes(platform)
    ? platform
    : detectPlatform(url);
  const handle = detectedPlatform === 'instagram' ? extractInstagramHandle(url) : null;

  try {
    const insert = await query(
      `INSERT INTO user_external_links (user_id, platform, url, handle, status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [req.session.userId, detectedPlatform, url, handle]
    );
    const id = insert.insertId;
    const fetched = await fetchUrlContent(url);
    if (fetched.text) {
      await query(
        `UPDATE user_external_links
            SET status = 'fetched', fetched_text = ?, fetch_error = NULL, last_fetched_at = NOW()
          WHERE id = ?`,
        [fetched.text, id]
      );
    } else {
      await query(
        `UPDATE user_external_links
            SET status = ?, fetch_error = ?, last_fetched_at = NOW()
          WHERE id = ?`,
        [fetched.error || 'failed', String(fetched.message || '').slice(0, 250), id]
      );
    }
    const row = await query(
      `SELECT id, platform, url, handle, status, fetch_error, last_fetched_at,
              CHAR_LENGTH(fetched_text) AS text_length, created_at
         FROM user_external_links WHERE id = ?`,
      [id]
    );
    res.status(201).json({ ok: true, link: row[0] });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ ok: false, error: '이미 등록된 URL입니다.' });
    }
    throw e;
  }
});

router.put('/api/me/external-links/:id/manual-text', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.text || '').trim();
  if (!text || text.length < 10) {
    return res.status(400).json({ ok: false, error: '10자 이상의 텍스트를 입력하세요.' });
  }
  if (text.length > 18000) {
    return res.status(400).json({ ok: false, error: '18000자 이하로 입력하세요.' });
  }
  const r = await query(
    `UPDATE user_external_links
        SET status = 'manual', fetched_text = ?, fetch_error = NULL, last_fetched_at = NOW()
      WHERE id = ? AND user_id = ?`,
    [text, id, req.session.userId]
  );
  if (r.affectedRows === 0) return res.status(404).json({ ok: false, error: '링크를 찾을 수 없습니다.' });
  res.json({ ok: true });
});

router.post('/api/me/external-links/:id/refetch', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(
    `SELECT id, url FROM user_external_links WHERE id = ? AND user_id = ?`,
    [id, req.session.userId]
  );
  if (!rows[0]) return res.status(404).json({ ok: false, error: '링크를 찾을 수 없습니다.' });
  const fetched = await fetchUrlContent(rows[0].url);
  if (fetched.text) {
    await query(
      `UPDATE user_external_links
          SET status = 'fetched', fetched_text = ?, fetch_error = NULL, last_fetched_at = NOW()
        WHERE id = ?`,
      [fetched.text, id]
    );
  } else {
    await query(
      `UPDATE user_external_links
          SET status = ?, fetch_error = ?, last_fetched_at = NOW()
        WHERE id = ?`,
      [fetched.error || 'failed', String(fetched.message || '').slice(0, 250), id]
    );
  }
  res.json({ ok: true, status: fetched.text ? 'fetched' : (fetched.error || 'failed'), message: fetched.message || null });
});

router.delete('/api/me/external-links/:id', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const r = await query(
    `DELETE FROM user_external_links WHERE id = ? AND user_id = ?`,
    [id, req.session.userId]
  );
  if (r.affectedRows === 0) return res.status(404).json({ ok: false, error: '링크를 찾을 수 없습니다.' });
  res.json({ ok: true });
});

router.get('/api/me/preference-profile', requireAuth, async (req, res) => {
  const rows = await query(
    `SELECT user_id, explorer, aesthetic, planner, spontaneous, persona_type,
            tags, destinations, summary, source, last_analyzed_at, updated_at
       FROM user_preference_profile WHERE user_id = ?`,
    [req.session.userId]
  );
  if (!rows[0]) return res.json({ ok: true, profile: null });
  const r = rows[0];
  const parseJson = (v) => {
    if (!v) return [];
    try {
      return typeof v === 'string' ? JSON.parse(v) : v;
    } catch {
      return [];
    }
  };
  res.json({
    ok: true,
    profile: {
      axes: {
        explorer: r.explorer,
        aesthetic: r.aesthetic,
        planner: r.planner,
        spontaneous: r.spontaneous,
      },
      personaType: r.persona_type,
      tags: parseJson(r.tags),
      destinations: parseJson(r.destinations),
      summary: r.summary,
      source: r.source,
      lastAnalyzedAt: r.last_analyzed_at,
      updatedAt: r.updated_at,
    },
  });
});

router.put('/api/me/preference-profile', requireAuth, async (req, res) => {
  const { axes, personaType, tags, destinations, summary } = req.body || {};
  const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n))));
  const a = axes || {};
  if ([a.explorer, a.aesthetic, a.planner, a.spontaneous].some((v) => !Number.isFinite(Number(v)))) {
    return res.status(400).json({ ok: false, error: '4개 축 모두 0~100 숫자로 입력하세요.' });
  }
  const personaTypeIn = ['explorer', 'aesthetic', 'planner', 'spontaneous'].includes(personaType)
    ? personaType
    : null;
  const tagsArr = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter(Boolean).slice(0, 12) : [];
  const destArr = Array.isArray(destinations) ? destinations.map((t) => String(t).trim()).filter(Boolean).slice(0, 8) : [];
  const summaryStr = String(summary || '').slice(0, 200);

  await query(
    `INSERT INTO user_preference_profile
       (user_id, explorer, aesthetic, planner, spontaneous, persona_type, tags, destinations, summary, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'user')
     ON DUPLICATE KEY UPDATE
       explorer = VALUES(explorer), aesthetic = VALUES(aesthetic),
       planner = VALUES(planner), spontaneous = VALUES(spontaneous),
       persona_type = VALUES(persona_type), tags = VALUES(tags),
       destinations = VALUES(destinations), summary = VALUES(summary),
       source = CASE WHEN source = 'ai' THEN 'mixed' ELSE 'user' END`,
    [
      req.session.userId,
      clamp(a.explorer),
      clamp(a.aesthetic),
      clamp(a.planner),
      clamp(a.spontaneous),
      personaTypeIn,
      JSON.stringify(tagsArr),
      JSON.stringify(destArr),
      summaryStr,
    ]
  );
  res.json({ ok: true });
});

router.post('/api/me/preference-profile/analyze', requireAuth, async (req, res) => {
  const links = await query(
    `SELECT platform, url, handle, fetched_text
       FROM user_external_links
      WHERE user_id = ? AND fetched_text IS NOT NULL AND CHAR_LENGTH(fetched_text) >= 30`,
    [req.session.userId]
  );

  let extra = String(req.body?.extraText || '').trim();
  if (extra.length > 0 && extra.length < 10) extra = '';

  const sources = links.map(
    (l) => `[${l.platform}${l.handle ? ' @' + l.handle : ''}] ${l.url}\n${l.fetched_text}`
  );
  if (extra) sources.push(`[직접입력]\n${extra.slice(0, 8000)}`);

  if (sources.length === 0) {
    return res.status(400).json({
      ok: false,
      error: '분석할 텍스트가 없습니다. 링크를 먼저 추가하거나 직접 텍스트를 입력하세요.',
    });
  }

  const sourceText = sources.join('\n\n=====\n\n').slice(0, 17000);

  let result;
  try {
    result = await analyzeTravelPreferences(sourceText);
  } catch (e) {
    if (e.code === 'NO_API_KEY') {
      return res.status(503).json({ ok: false, error: e.message });
    }
    if (e.status === 401) {
      return res.status(503).json({ ok: false, error: 'Anthropic API 키 인증 실패' });
    }
    if (e.status === 429) {
      return res.status(429).json({ ok: false, error: 'Anthropic API 호출 한도 초과. 잠시 후 다시 시도하세요.' });
    }
    console.error('analyze error', e);
    return res.status(500).json({ ok: false, error: e.message || '분석 중 오류 발생' });
  }

  const p = result.profile;
  await query(
    `INSERT INTO user_preference_profile
       (user_id, explorer, aesthetic, planner, spontaneous, persona_type, tags, destinations, summary, source, last_analyzed_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', NOW())
     ON DUPLICATE KEY UPDATE
       explorer = VALUES(explorer), aesthetic = VALUES(aesthetic),
       planner = VALUES(planner), spontaneous = VALUES(spontaneous),
       persona_type = VALUES(persona_type), tags = VALUES(tags),
       destinations = VALUES(destinations), summary = VALUES(summary),
       source = 'ai', last_analyzed_at = NOW()`,
    [
      req.session.userId,
      p.explorer,
      p.aesthetic,
      p.planner,
      p.spontaneous,
      p.persona_type,
      JSON.stringify(p.tags || []),
      JSON.stringify(p.destinations || []),
      p.summary || '',
    ]
  );

  await query(
    `INSERT INTO user_preference_analyses (user_id, snapshot, source_summary, model, tokens_in, tokens_out)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      req.session.userId,
      JSON.stringify(p),
      sourceText.slice(0, 2000),
      result.usage.model,
      result.usage.input_tokens + result.usage.cache_read_input_tokens,
      result.usage.output_tokens,
    ]
  );

  res.json({
    ok: true,
    profile: {
      axes: {
        explorer: p.explorer,
        aesthetic: p.aesthetic,
        planner: p.planner,
        spontaneous: p.spontaneous,
      },
      personaType: p.persona_type,
      tags: p.tags || [],
      destinations: p.destinations || [],
      summary: p.summary || '',
      source: 'ai',
    },
    usage: result.usage,
  });
});

export default router;
