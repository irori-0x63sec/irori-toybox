const DEFAULT_GAME = 'lexi-blaster';
const ALLOWED_GAMES = [DEFAULT_GAME];
const ALLOWED_MODES = ['en_en', 'jp_en', 'en_jp'];
const ALLOWED_LEVELS = ['A1','A2','A3','B1','B2','B3','C1','C2','C3'];

const MAX_NAME_LENGTH = 12;
const MAX_SCORE = 999999;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const STORAGE_LIMIT = 5000;
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW = 60; // seconds

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = normalizePath(url.pathname);

    if (request.method === 'OPTIONS') {
      return handleOptions(request, env);
    }

    if (pathname === '/top' && request.method === 'GET') {
      return handleGetTop(request, env);
    }
    if (pathname === '/score' && request.method === 'POST') {
      return handlePostScore(request, env, ctx);
    }

    return jsonResponse({ error: 'NOT_FOUND' }, 404, request, env);
  }
};

function normalizePath(pathname){
  if (!pathname) return '/';
  const trimmed = pathname.replace(/\/+$/g, '') || '/';
  return trimmed;
}

async function handleGetTop(request, env){
  const url = new URL(request.url);
  const context = normalizeContext({
    game: url.searchParams.get('game'),
    mode: url.searchParams.get('mode'),
    level: url.searchParams.get('level')
  }, { strict: true });
  if (!context.ok) {
    return jsonResponse({ error: context.error }, 400, request, env);
  }

  const rawLimit = Number(url.searchParams.get('limit'));
  const limit = clampLimit(rawLimit);

  try {
    const kv = requireKv(env.LEADERBOARD, 'LEADERBOARD');
    const key = buildKey(context.value);
    const records = await readEntries(kv, key);
    const sorted = sortEntries(records);
    const top = sorted.slice(0, limit).map((entry, idx) => ({
      name: entry.name,
      score: entry.score,
      timestamp: entry.timestamp,
      rank: idx + 1
    }));
    return jsonResponse({ results: top }, 200, request, env, { 'Cache-Control': 'no-store' });
  } catch (err) {
    console.error('[leaderboard] GET /top failed', err);
    return jsonResponse({ error: 'INTERNAL_ERROR' }, 500, request, env);
  }
}

async function handlePostScore(request, env, ctx){
  let payload;
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: 'INVALID_JSON' }, 400, request, env);
  }

  const context = normalizeContext({
    game: payload?.game,
    mode: payload?.mode,
    level: payload?.level
  }, { strict: true });
  if (!context.ok) {
    return jsonResponse({ error: context.error }, 400, request, env);
  }

  const name = sanitizeName(payload?.name);
  const score = clampScore(payload?.score);
  if (!name) {
    return jsonResponse({ error: 'NAME_REQUIRED' }, 400, request, env);
  }
  if (!(score > 0)) {
    return jsonResponse({ error: 'SCORE_REQUIRED' }, 400, request, env);
  }

  try {
    const kv = requireKv(env.LEADERBOARD, 'LEADERBOARD');
    const rateKv = env.LEADERBOARD_RATELIMIT;
    const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || request.cf?.connectingIP || 'unknown';
    const rateKey = buildRateLimitKey(context.value, ip);

    if (rateKv) {
      const allowed = await checkRateLimit(rateKv, rateKey);
      if (!allowed) {
        return jsonResponse({ error: 'RATE_LIMITED' }, 429, request, env, { 'Retry-After': String(RATE_LIMIT_WINDOW) });
      }
    }

    const entry = {
      id: crypto.randomUUID(),
      name,
      score,
      timestamp: Date.now()
    };

    const key = buildKey(context.value);
    const existing = await readEntries(kv, key);
    const updated = appendEntry(existing, entry);
    const sorted = sortEntries(updated);
    const rankIndex = sorted.findIndex(item => item.id === entry.id);
    const rank = rankIndex >= 0 ? rankIndex + 1 : null;

    const storePromise = kv.put(key, JSON.stringify(updated));
    ctx.waitUntil(storePromise);

    return jsonResponse({ ok: true, rank, entry: { name: entry.name, score: entry.score, timestamp: entry.timestamp } }, 200, request, env);
  } catch (err) {
    console.error('[leaderboard] POST /score failed', err);
    return jsonResponse({ error: 'INTERNAL_ERROR' }, 500, request, env);
  }
}

function sanitizeName(value){
  if (typeof value !== 'string') return '';
  let cleaned = value.replace(/[\u0000-\u001F\u007F]/g, '').trim();
  cleaned = cleaned.replace(/\s+/g, ' ');
  if (cleaned.length > MAX_NAME_LENGTH) cleaned = cleaned.slice(0, MAX_NAME_LENGTH);
  return cleaned;
}

function clampScore(value){
  const num = Math.floor(Number(value) || 0);
  if (!Number.isFinite(num) || num < 0) return 0;
  return Math.min(num, MAX_SCORE);
}

function clampLimit(value){
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(value)));
}

function normalizeContext(meta, { strict = false } = {}){
  const game = sanitizeGame(meta?.game) || (strict ? '' : DEFAULT_GAME);
  const mode = sanitizeMode(meta?.mode);
  const level = sanitizeLevel(meta?.level);

  if (!game) return { ok: false, error: 'INVALID_GAME' };
  if (!mode) return { ok: false, error: 'INVALID_MODE' };
  if (!level) return { ok: false, error: 'INVALID_LEVEL' };

  return { ok: true, value: { game, mode, level } };
}

function sanitizeGame(value){
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return ALLOWED_GAMES.includes(normalized) ? normalized : '';
}

function sanitizeMode(value){
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toLowerCase();
  return ALLOWED_MODES.includes(normalized) ? normalized : '';
}

function sanitizeLevel(value){
  if (typeof value !== 'string') return '';
  const normalized = value.trim().toUpperCase();
  return ALLOWED_LEVELS.includes(normalized) ? normalized : '';
}

function buildKey(context){
  return `lb:v1:${context.game}:${context.mode}:${context.level}`;
}

function appendEntry(list, entry){
  const next = Array.isArray(list) ? [...list, entry] : [entry];
  if (next.length > STORAGE_LIMIT) {
    next.splice(0, next.length - STORAGE_LIMIT);
  }
  return next;
}

function sortEntries(list){
  const entries = Array.isArray(list) ? [...list] : [];
  entries.sort((a, b) => {
    const sa = Number.isFinite(a?.score) ? a.score : 0;
    const sb = Number.isFinite(b?.score) ? b.score : 0;
    if (sb !== sa) return sb - sa;
    const ta = Number.isFinite(a?.timestamp) ? a.timestamp : Number.MAX_SAFE_INTEGER;
    const tb = Number.isFinite(b?.timestamp) ? b.timestamp : Number.MAX_SAFE_INTEGER;
    return ta - tb;
  });
  return entries;
}

async function readEntries(kv, key){
  try {
    const raw = await kv.get(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(item => ({
      id: item?.id || crypto.randomUUID(),
      name: sanitizeName(item?.name),
      score: clampScore(item?.score),
      timestamp: Number.isFinite(item?.timestamp) ? item.timestamp : null
    }));
  } catch {
    return [];
  }
}

function requireKv(kv, name){
  if (!kv || typeof kv.get !== 'function' || typeof kv.put !== 'function') {
    throw new Error(`${name}_KV_NOT_CONFIGURED`);
  }
  return kv;
}

function buildRateLimitKey(context, ip){
  return `rl:v1:${context.game}:${context.mode}:${context.level}:${ip}`;
}

async function checkRateLimit(kv, key){
  const bucket = await kv.get(key);
  const count = bucket ? Number(bucket) : 0;
  if (Number.isFinite(count) && count >= RATE_LIMIT_MAX) {
    return false;
  }
  const nextCount = Number.isFinite(count) && count >= 0 ? count + 1 : 1;
  await kv.put(key, String(nextCount), { expirationTtl: RATE_LIMIT_WINDOW });
  return true;
}

function parseAllowedOrigins(env){
  if (!env || typeof env.ALLOWED_ORIGINS !== 'string') return null;
  const list = env.ALLOWED_ORIGINS.split(',').map(s => s.trim()).filter(Boolean);
  return list.length ? list : null;
}

function resolveCors(request, env){
  const originHeader = request.headers.get('Origin');
  if (!originHeader) {
    return { allowed: true, headers: {} };
  }
  const allowedList = parseAllowedOrigins(env);
  if (!allowedList) {
    return { allowed: true, headers: { 'Access-Control-Allow-Origin': originHeader, 'Vary': 'Origin' } };
  }
  if (allowedList.includes('*')) {
    return { allowed: true, headers: { 'Access-Control-Allow-Origin': '*', 'Vary': 'Origin' } };
  }
  if (allowedList.includes(originHeader)) {
    return { allowed: true, headers: { 'Access-Control-Allow-Origin': originHeader, 'Vary': 'Origin' } };
  }
  return { allowed: false, headers: {} };
}

function handleOptions(request, env){
  const cors = resolveCors(request, env);
  if (!cors.allowed) {
    return new Response(null, { status: 403 });
  }
  const headers = {
    ...cors.headers,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400'
  };
  return new Response(null, { status: 204, headers });
}

function jsonResponse(body, status, request, env, extraHeaders = {}){
  const cors = resolveCors(request, env);
  if (!cors.allowed) {
    return new Response(JSON.stringify({ error: 'ORIGIN_NOT_ALLOWED' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }
  const headers = {
    'Content-Type': 'application/json',
    ...cors.headers,
    ...extraHeaders
  };
  if (!headers['Cache-Control']) {
    headers['Cache-Control'] = 'no-store';
  }
  return new Response(JSON.stringify(body), { status, headers });
}
