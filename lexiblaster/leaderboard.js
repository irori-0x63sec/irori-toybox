(function () {
  'use strict';

  // ===== 基本設定 =====
  const MAX_NAME_LENGTH = 12;
  const DEFAULT_MODE  = 'en_en';
  const DEFAULT_LEVEL = 'A1';

  // ===== API ベース URL 決定（安全な優先順位）=====
  const scriptEl = document.currentScript;
  const baseCandidates = [
    // 明示指定が最優先（index.html の data-api-base）
    scriptEl?.dataset?.apiBase,
    // グローバルに置いたとき
    typeof window !== 'undefined'
      ? (window.LEXI_LEADERBOARD_BASE || window.LEXI_LEADERBOARD_ENDPOINT || window.LEADERBOARD_API_BASE)
      : null,
    // 直書きバックアップ
    'https://lb.irori-toybox.com',
    // 最終手段（同一オリジン内に API をプロキシしている場合のみ）
    (typeof location !== 'undefined') ? `${location.origin}/api/leaderboard` : null,
  ].filter(Boolean);

  function sanitizeBase(value) {
    try {
      const u = new URL(value, typeof location !== 'undefined' ? location.origin : 'https://example.com');
      if (!/^https?:$/i.test(u.protocol)) return '';
      const path = u.pathname.replace(/\/+$/g, '');
      return `${u.origin}${path}`;
    } catch { return ''; }
  }
  function pickBase(cands) {
    for (const c of cands) {
      const ok = sanitizeBase(c);
      if (ok) return ok;
    }
    return '';
  }
  const API_BASE = pickBase(baseCandidates);

  function buildUrl(path) {
    if (!API_BASE) throw new Error('Leaderboard API base is not configured');
    return new URL(String(path).replace(/^\/+/, ''), `${API_BASE}/`).toString();
  }

  // ===== 小物 =====
  const $  = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function setStatus(el, msg, type = 'info') {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.className = 'lb-status';
    if (type) el.classList.add(`lb-status--${type}`);
  }

  function sanitizeName(raw) {
    if (typeof raw !== 'string') raw = '';
    let s = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    s = s.replace(/\s+/g, ' ');
    if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH);
    return s;
  }

  function fmtScore(n) {
    try { return Number(n || 0).toLocaleString('ja-JP'); }
    catch { return String(n ?? 0); }
  }

  // ===== API クライアント =====
  async function fetchTop(limit = 20, context = {}) {
    const url = new URL(buildUrl('/top'));
    url.searchParams.set('limit', Math.min(Math.max(1, limit|0), 100));
    if (context.mode)  url.searchParams.set('mode',  String(context.mode));
    if (context.level) url.searchParams.set('level', String(context.level));

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const json = await res.json().catch(() => ({}));
    return Array.isArray(json.items) ? json.items : [];
  }

  async function postScore({ name, score, mode, level }) {
    const payload = {
      name: sanitizeName(name),
      score: Math.min(Math.max(1, Number(score)|0), 999999),
      mode:  String(mode || DEFAULT_MODE),
      level: String(level || DEFAULT_LEVEL),
    };
    if (!payload.name) return { ok:false, error:'NAME_REQUIRED' };

    const res = await fetch(buildUrl('/score'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Submit failed (${res.status}) ${text}`.trim());
    }
    return await res.json().catch(() => ({ ok:true }));
  }

  // ===== window.lexiLeaderboard を先に公開 =====
  if (typeof window !== 'undefined') {
    window.lexiLeaderboard = {
      // API
      apiBase: API_BASE,
      fetchLeaderboard: fetchTop,
      submitScore: (name, score, mode, level) => postScore({ name, score, mode, level }),
      // 表示補助
      describeMode: (m) => (m === 'jp_en' ? 'JP→EN' : 'EN→EN'),
      allowedModes:  ['en_en','jp_en'],
      allowedLevels: ['A1','A2','A3','B1','B2','B3','C1','C2','C3'],
      defaultContext: { game:'lexi-blaster', mode: DEFAULT_MODE, level: DEFAULT_LEVEL },
      // デバッグ
      getEffectiveName: () => {
        const ni = getNameInput();
        return sanitizeName(ni?.value ?? '');
      },
      setStatusElement: setStatus,
      renderVerticalList(root, items, opt = {}) {
        const list   = opt.list;
        const status = opt.status;
        if (!list) { setStatus(status, '表示先が見つかりません。', 'warning'); return; }
        list.innerHTML = '';
        if (!items || items.length === 0) {
          setStatus(status, opt.emptyMessage || 'まだ登録がありません。', opt.emptyStatusType || 'info');
          return;
        }
        setStatus(status, '', 'info');
        for (const item of items) {
          const li = document.createElement('li');
          li.className = 'lb-row';
          const rank  = document.createElement('span'); rank.className = 'lb-rank';  rank.textContent  = `${item.rank ?? ''}位`;
          const name  = document.createElement('span'); name.className = 'lb-name';  name.textContent  = item.name || '名無し';
          const score = document.createElement('span'); score.className = 'lb-score'; score.textContent = `${fmtScore(item.score)}pt`;
          li.append(rank, name, score);
          list.appendChild(li);
        }
      },
      normalizeContext(input, fallback, opt = {}) {
        const ctx = Object.assign({}, fallback || {});
        if (input?.mode)  ctx.mode  = String(input.mode);
        if (input?.level) ctx.level = String(input.level);
        // strictのときは不正値を弾いて既定値に戻す
        if (opt.strict) {
          if (!this.allowedModes.includes(ctx.mode))   ctx.mode  = DEFAULT_MODE;
          if (!this.allowedLevels.includes(ctx.level)) ctx.level = DEFAULT_LEVEL;
        }
        return ctx;
      }
    };
  }

  // ====== UI 初期化（要素がある時だけ動く）======
  function getNameInput() {
    return (
      $('#lb-leaderboard-name') ||
      $('#lb-name') ||
      $('input[name="name"]') ||
      $('input[name="handle"]') ||
      $('input[data-lb="name"]')
    );
  }
  function getModeValue() {
    const el =
      $('#lb-mode') ||
      $('select[name="mode"]') ||
      $('[data-mode-current]');
    const val = el?.value || el?.dataset?.modeCurrent;
    return (val && typeof val === 'string') ? val : DEFAULT_MODE;
  }
  function getLevelValue() {
    const el =
      $('#lb-level') ||
      $('select[name="level"]') ||
      $('[data-level-current]');
    const val = el?.value || el?.dataset?.levelCurrent;
    return (val && typeof val === 'string') ? val : DEFAULT_LEVEL;
  }
  function getScoreValue() {
    const el = $('#lb-score') || $('input[name="score"]');
    const n = Math.round(Number(el?.value || 0));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 999999) : 0;
    // ゲーム側から別途渡すならここは未使用でもOK
  }

  function initIfElementsExist() {
    // どれか一つでもあるなら UI を有効化
    const form   = $('#lb-leaderboard-form') || $('#lb-form');
    const status = $('#lb-leaderboard-status') || $('#lb-status') || $('#lb-embed-status');
    const list   = $('#lb-leaderboard-body') || $('#lb-list') || $('#lb-embed-list');
    const panel  = $('#lb-embed') || $('#lb-panel');

    if (!form && !status && !list && !panel) {
      // UI が無いページ（＝API だけ提供）。何もしない。
      return;
    }

    async function refresh() {
      if (panel) panel.hidden = false;
      setStatus(status, 'ランキングを読み込み中…', 'loading');
      try {
        const items = await fetchTop(20, { mode: getModeValue(), level: getLevelValue() });
        window.lexiLeaderboard.renderVerticalList(panel || document, items, {
          list, status,
          emptyMessage: 'まだ登録がありません。最初の挑戦者になろう！',
          emptyStatusType: 'info'
        });
      } catch (e) {
        console.error('[Leaderboard] fetch failed', e);
        window.lexiLeaderboard.renderVerticalList(panel || document, [], {
          list, status,
          emptyMessage: 'ランキングを取得できませんでした。',
          emptyStatusType: 'error'
        });
      }
    }

    async function onSubmit(e) {
      if (e) e.preventDefault();
      const nameInput = getNameInput();
      const raw   = nameInput?.value ?? '';
      const name  = sanitizeName(raw);
      const score = getScoreValue();
      if (!name) {
        setStatus(status, 'ハンドルネームを入力してください。', 'warning');
        nameInput?.focus();
        return;
      }
      if (!(score > 0)) {
        setStatus(status, 'スコアが0のため登録できません。', 'warning');
        return;
      }
      setStatus(status, 'スコア送信中…', 'loading');
      try {
        const result = await postScore({ name, score, mode: getModeValue(), level: getLevelValue() });
        if (result && result.ok === false && result.error === 'NAME_REQUIRED') {
          setStatus(status, 'ハンドルネームを入力してください。', 'warning');
          return;
        }
        setStatus(status, 'ランキングに登録しました！', 'success');
        await refresh();
      } catch (err) {
        console.error('[Leaderboard] submit failed', err);
        setStatus(status, '送信に失敗しました。通信環境をご確認ください。', 'error');
      }
    }

    if (form) form.addEventListener('submit', onSubmit);
    refresh();
  }

  // DOM 準備後にだけ UI 初期化（API は即利用可）
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initIfElementsExist, { once: true });
    } else {
      initIfElementsExist();
    }
  }
})();
