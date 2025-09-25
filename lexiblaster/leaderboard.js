// lexiblaster/leaderboard.js  （丸ごと置き換え）

(function () {
  'use strict';

  // ---------- 設定 ----------
  const MAX_NAME_LENGTH = 12;
  const DEFAULT_MODE  = 'en_en';
  const DEFAULT_LEVEL = 'A1';

  // APIベースURLの候補（優先順位を data-* / window 先に）
  const scriptEl = document.currentScript;
  const baseCandidates = [
    scriptEl?.dataset?.apiBase,
    typeof window !== 'undefined' ? (window.LEXI_LEADERBOARD_BASE || window.LEXI_LEADERBOARD_ENDPOINT || window.LEADERBOARD_API_BASE) : null,
    'https://lb.irori-toybox.com',                                  // 直書きバックアップ
    (typeof location !== 'undefined') ? `${location.origin}/api/leaderboard` : null // 最後にサイト内相対
  ].filter(Boolean);

  const API_BASE = pickBase(baseCandidates);

  function pickBase(cands) {
    for (const c of cands) {
      const ok = sanitizeBase(c);
      if (ok) return ok;
    }
    return '';
  }
  function sanitizeBase(value) {
    try {
      const u = new URL(value, typeof location !== 'undefined' ? location.origin : 'https://example.com');
      if (!/^https?:$/i.test(u.protocol)) return '';
      const path = u.pathname.replace(/\/+$/g, '');
      return `${u.origin}${path}`;
    } catch { return ''; }
  }
  function buildUrl(path) {
    if (!API_BASE) throw new Error('Leaderboard API base is not configured');
    return new URL(String(path).replace(/^\/+/, ''), `${API_BASE}/`).toString();
  }

  // ---------- DOM helpers ----------
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  // 名前入力をどこからでも拾えるように（ID差異・埋め込み差異に強い）
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
    // ページにより保管場所が違う可能性があるので広めに探す
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

  // 必要ならスコアを受け取る（ページによりない場合もある）
  function getScoreValue() {
    const el = $('#lb-score') || $('input[name="score"]');
    const n = Math.round(Number(el?.value || 0));
    return Number.isFinite(n) && n > 0 ? Math.min(n, 999999) : 0;
  }

  // ---------- 表示 ----------
  function setStatus(el, msg, type = 'info') {
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
    el.className = 'lb-status';
    if (type) el.classList.add(`lb-status--${type}`);
  }

  function renderVerticalList(listRoot, items, { list, status, emptyMessage = 'まだ登録がありません。', emptyStatusType = 'info' } = {}) {
    if (!listRoot || !list) return;
    list.innerHTML = '';
    if (!Array.isArray(items) || items.length === 0) {
      setStatus(status, emptyMessage, emptyStatusType);
      return;
    }
    setStatus(status, '', 'info');

    for (const item of items) {
      const li = document.createElement('li');
      const rank = document.createElement('span');
      const name = document.createElement('span');
      const score = document.createElement('span');

      rank.className = 'lb-rank';
      name.className = 'lb-name';
      score.className = 'lb-score';

      rank.textContent = `${item.rank ?? ''}位`;
      name.textContent = item.name || '名無し';
      score.textContent = `${Number(item.score || 0).toLocaleString('ja-JP')}pt`;

      li.append(rank, name, score);
      list.appendChild(li);
    }
  }

  // ---------- バリデーション ----------
  function sanitizeName(raw) {
    if (typeof raw !== 'string') raw = '';
    // 制御文字除去＋trim
    let s = raw.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    // 連続空白を1つに
    s = s.replace(/\s+/g, ' ');
    // 最大長
    if (s.length > MAX_NAME_LENGTH) s = s.slice(0, MAX_NAME_LENGTH);
    return s;
  }

  // ---------- API ----------
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
      level: String(level || DEFAULT_LEVEL)
    };
    if (!payload.name) {
      // ここでは例外を投げず、呼び出し側でUI表示させる
      return { ok: false, error: 'NAME_REQUIRED' };
    }

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
    return await res.json().catch(() => ({ ok: true }));
  }

  // ---------- 初期化（ゲーム内のリザルト用） ----------
  function initInGame() {
    // ゲーム側の要素（あるページと無いページがあるので存在チェック）
    const form   = document.getElementById('lb-leaderboard-form') || document.getElementById('lb-form');
    const status = document.getElementById('lb-leaderboard-status') || document.getElementById('lb-status');
    const list   = document.getElementById('lb-leaderboard-body') || document.getElementById('lb-list');
    const panel  = document.getElementById('lb-embed') || document.getElementById('lb-panel');

    async function refresh() {
      if (panel) panel.hidden = false;
      setStatus(status, 'ランキングを読み込み中…', 'loading');
      try {
        const items = await fetchTop(20, { mode: getModeValue(), level: getLevelValue() });
        renderVerticalList(panel || document, items, { list, status, emptyMessage: 'まだ登録がありません。最初の挑戦者になろう！' });
      } catch (e) {
        console.error('[Leaderboard] fetch failed', e);
        renderVerticalList(panel || document, [], { list, status, emptyMessage: 'ランキングを取得できませんでした。', emptyStatusType: 'error' });
      }
    }

    async function onSubmit(e) {
      if (e) e.preventDefault();
      const nameInput = getNameInput();
      const raw = nameInput?.value ?? '';
      const name = sanitizeName(raw);
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
          // 念のため
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

    if (form) {
      form.addEventListener('submit', onSubmit);
    }
    // 画面を開いたら自動で最新表示
    refresh();
  }

  // ---------- 自動起動 ----------
  function ready() { initInGame(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ready, { once: true });
  } else {
    ready();
  }

  // ---------- デバッグ露出 ----------
  if (typeof window !== 'undefined') {
    window.lexiLeaderboard = Object.assign(window.lexiLeaderboard || {}, {
      apiBase: API_BASE,
      fetchLeaderboard: fetchTop,
      submitScore: (name, score, mode, level) => postScore({ name, score, mode, level }),
      getEffectiveName: () => sanitizeName(getNameInput()?.value ?? ''),
      describeMode: (m) => (m === 'jp_en' ? 'JP→EN' : 'EN→EN')
    });
  }
})();
