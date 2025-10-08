(function () {
  'use strict';

  // ===== 基本設定 =====
  const MAX_NAME_LENGTH = 12;
  const DEFAULT_MODE  = 'en_en';
  const DEFAULT_LEVEL = 'A1';
  const ALLOWED_MODES  = ['en_en', 'jp_en'];
  const ALLOWED_LEVELS = ['A1','A2','A3','B1','B2','B3','C1','C2','C3'];

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

  function pickMode(primary, secondary) {
    const candidates = [primary, secondary, DEFAULT_MODE];
    for (const cand of candidates) {
      if (typeof cand !== 'string') continue;
      const normalized = cand.trim().toLowerCase();
      if (!normalized) continue;
      if (ALLOWED_MODES.includes(normalized)) return normalized;
    }
    return DEFAULT_MODE;
  }

  function pickLevel(primary, secondary) {
    const candidates = [primary, secondary, DEFAULT_LEVEL];
    for (const cand of candidates) {
      if (typeof cand !== 'string') continue;
      const normalized = cand.trim().toUpperCase();
      if (!normalized) continue;
      if (ALLOWED_LEVELS.includes(normalized)) return normalized;
    }
    return DEFAULT_LEVEL;
  }

  function clampScoreValue(value) {
    const num = Math.floor(Number(value) || 0);
    if (!Number.isFinite(num) || num <= 0) return 0;
    return Math.min(num, 999999);
  }

  // ===== API クライアント =====
  async function fetchLeaderboardInternal(limit = 20, context = {}) {
    const url = new URL(buildUrl('/top'));
    const safeLimit = Number.isFinite(limit)
      ? Math.max(1, Math.min(100, Math.floor(limit)))
      : Math.max(1, Math.min(100, Math.floor(Number(limit) || 20)));
    url.searchParams.set('limit', safeLimit);

    const mode = pickMode(context?.mode);
    const level = pickLevel(context?.level);
    url.searchParams.set('mode', mode);
    url.searchParams.set('level', level);

    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store'
    });
    if (!res.ok) throw new Error(`Fetch failed (${res.status})`);
    const json = await res.json().catch(() => ({}));
    const rawItems = Array.isArray(json.items)
      ? json.items
      : Array.isArray(json.results)
        ? json.results
        : [];

    return rawItems.map((item, idx) => {
      const fallbackMode = pickMode(item?.mode, mode);
      const fallbackLevel = pickLevel(item?.level, level);
      const tsValue = Number(item?.ts);
      const tsFallback = Number(item?.timestamp);
      const timestamp = Number.isFinite(tsValue)
        ? tsValue
        : Number.isFinite(tsFallback)
          ? tsFallback
          : null;
      const rankValue = Number(item?.rank);
      const scoreValue = clampScoreValue(item?.score);
      const fallbackScore = Math.max(0, Math.floor(Number(item?.score) || 0));
      return {
        rank: Number.isFinite(rankValue) && rankValue > 0 ? rankValue : idx + 1,
        name: typeof item?.name === 'string' ? item.name : '',
        score: scoreValue > 0 ? scoreValue : fallbackScore,
        mode: fallbackMode,
        level: fallbackLevel,
        weak: !!item?.weak,
        ts: timestamp,
        timestamp
      };
    });
  }

  async function submitScoreInternal(name, score, context = {}) {
    const payload = {
      name: sanitizeName(name),
      score: clampScoreValue(score),
      mode: pickMode(context?.mode),
      level: pickLevel(context?.level),
    };
    if (!payload.name) return { ok: false, error: 'NAME_REQUIRED' };
    if (!(payload.score > 0)) return { ok: false, error: 'SCORE_REQUIRED' };

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

  // ===== window.lexiLeaderboard を先に公開 =====
  if (typeof window !== 'undefined') {
    window.lexiLeaderboard = {
      // API
      apiBase: API_BASE,
      fetchLeaderboard(limit, context, level) {
        let ctx = context;
        if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) {
          ctx = { mode: context, level };
        }
        return fetchLeaderboardInternal(limit, ctx);
      },
      submitScore(name, score, context, level) {
        let ctx = context;
        if (!ctx || typeof ctx !== 'object' || Array.isArray(ctx)) {
          ctx = { mode: context, level };
        }
        return submitScoreInternal(name, score, ctx);
      },
      // 表示補助
      describeMode: (m) => {
        const key = pickMode(m);
        switch (key) {
          case 'en_jp': return 'EN→JP';
          case 'jp_en': return 'JP→EN';
          case 'en_en': return 'EN→EN';
          default: return key || '';
        }
      },
      allowedModes:  [...ALLOWED_MODES],
      allowedLevels: [...ALLOWED_LEVELS],
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
        ctx.mode = pickMode(input?.mode, ctx.mode);
        ctx.level = pickLevel(input?.level, ctx.level);
        if (opt.strict) {
          return { mode: ctx.mode, level: ctx.level };
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
    return pickMode(val);
  }
  function getLevelValue() {
    const el =
      $('#lb-level') ||
      $('select[name="level"]') ||
      $('[data-level-current]');
    const val = el?.value || el?.dataset?.levelCurrent;
    return pickLevel(val);
  }
  function getScoreValue() {
    const el = $('#lb-score') || $('input[name="score"]');
    return clampScoreValue(el?.value);
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
        const items = await fetchLeaderboardInternal(20, { mode: getModeValue(), level: getLevelValue() });
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
        const result = await submitScoreInternal(name, score, { mode: getModeValue(), level: getLevelValue() });
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

    // ====== ゲーム内オーバーレイ連携（lb:leaderboard:show / hide） ======
(function () {
  if (typeof window === 'undefined' || !window.lexiLeaderboard) return;

  const lb = window.lexiLeaderboard;

  // root（結果画面のコンテナ）配下で使う要素を収集
  function collect(root) {
    if (!root) return null;
    return {
      root,
      status: root.querySelector('#lb-leaderboard-status'),
      form: root.querySelector('#lb-leaderboard-form'),
      name: root.querySelector('#lb-leaderboard-name'),
      submit: root.querySelector('#lb-leaderboard-submit'),
      table: root.querySelector('#lb-leaderboard-table'),
      tbody: root.querySelector('#lb-leaderboard-body'),
      empty: root.querySelector('#lb-leaderboard-empty'),
      heading: root.querySelector('#lb-leaderboard-heading'),
      verticalHeading: root.querySelector('#lb-vertical-heading'),
      // あるかもしれない現在モード/レベルの表示
      modeEl: root.querySelector('[data-mode-current]'),
      levelEl: root.querySelector('[data-level-current]'),
    };
  }

  function resolveContext(detail, root) {
    const meta = detail?.meta || {};
    const mode = pickMode(meta.mode, root?.dataset?.mode || lb.defaultContext.mode);
    const level = pickLevel(meta.level, root?.dataset?.level || lb.defaultContext.level);
    return { mode, level };
  }

  async function renderTop(elems, ctx, limit = 10) {
    if (!elems) return;
    const { status, tbody, table, empty } = elems;

    // 縦表示UIと同等の簡易レンダラ
    try {
      lb.setStatusElement(status, 'ランキングを読み込み中…', 'loading');
      const items = await lb.fetchLeaderboard(limit, ctx);

      // テーブル系がないページもあるので、縦リストの簡易レンダで代替
      if (!tbody) {
        const list = elems.root.querySelector('#lb-embed-list');
        const status2 = elems.root.querySelector('#lb-embed-status') || status;
        if (list) {
          lb.renderVerticalList(elems.root, items, {
            list,
            status: status2,
            limit,
            emptyMessage: 'まだ登録がありません。最初の挑戦者になろう！',
            emptyStatusType: 'info'
          });
          return;
        }
      }

      // テーブルがある場合の描画
      if (tbody) tbody.innerHTML = '';
      if (!items || items.length === 0) {
        if (table) table.style.display = 'none';
        if (empty) empty.hidden = false;
        lb.setStatusElement(status, 'まだ登録がありません。最初の挑戦者になろう！', 'info');
        return;
      }
      if (table) table.style.display = '';
      if (empty) empty.hidden = true;

      const frag = document.createDocumentFragment();
      for (const row of items) {
        const tr = document.createElement('tr');
        const tdRank  = document.createElement('td'); tdRank.textContent  = `${row.rank ?? ''}`;
        const tdName  = document.createElement('td'); tdName.textContent  = row.name || '名無し';
        const tdScore = document.createElement('td'); tdScore.textContent = Number(row.score||0).toLocaleString('ja-JP');
        tr.append(tdRank, tdName, tdScore);
        frag.appendChild(tr);
      }
      if (tbody) tbody.appendChild(frag);
      lb.setStatusElement(status, '最新のランキングを表示しています。', 'info');
    } catch (err) {
      console.error('[lb overlay] fetch failed', err);
      lb.setStatusElement(elems?.status, 'ランキングを取得できませんでした。', 'error');
      if (elems?.table) elems.table.style.display = 'none';
      if (elems?.empty) elems.empty.hidden = false;
    }
  }

  function bindForm(elems, finalScore, ctx) {
    if (!elems?.form) return;
    const { form, name, status, submit } = elems;

    // ボタン活性/非活性
    if (submit) submit.disabled = !(finalScore > 0);

    const onSubmit = async (ev) => {
      ev.preventDefault();
      const handle = (name?.value ?? '').trim();
      if (!handle) {
        lb.setStatusElement(status, 'ハンドルネームを入力してください。', 'warning');
        name?.focus();
        return;
      }
      if (!(finalScore > 0)) {
        lb.setStatusElement(status, 'スコアが0のため登録できません。', 'warning');
        return;
      }
      lb.setStatusElement(status, 'スコア送信中…', 'loading');
      try {
        await lb.submitScore(handle, finalScore, ctx);
        lb.setStatusElement(status, 'ランキングに登録しました！', 'success');
        await renderTop(elems, ctx, 10);
      } catch (e) {
        console.error('[lb overlay] submit failed', e);
        // エラーメッセージの代表例に合わせる
        const msg = /NAME_REQUIRED/.test(String(e?.message)) ?
          'ハンドルネームを入力してください。' :
          '送信に失敗しました。通信環境をご確認ください。';
        lb.setStatusElement(status, msg, /NAME_REQUIRED/.test(String(e?.message)) ? 'warning' : 'error');
      }
    };

    form.addEventListener('submit', onSubmit, { passive: false });
  }

  // 表示イベント
  window.addEventListener('lb:leaderboard:show', (ev) => {
    const detail = ev?.detail || {};
    const root   = detail.root;               // ゲーム側が渡すコンテナ要素
    const score  = Math.max(0, Number(detail.total) || 0);
    if (!root) return;                        // root が無いなら何もしない

    const elems = collect(root);
    if (elems?.root) {
      elems.root.hidden = false;
      elems.root.setAttribute('data-active', '1');
    }

    const ctx = resolveContext(detail, root);
    if (elems?.root) {
      elems.root.dataset.mode = ctx.mode;
      elems.root.dataset.level = ctx.level;
    }
    // 見出しがあるなら更新（任意）
    const heading = root.querySelector('#lb-embed-heading');
    if (heading) heading.textContent = `ランキング（${ctx.level} / ${lb.describeMode(ctx.mode)}）`;

    // 初期ステータス
    lb.setStatusElement(elems?.status,
      score > 0 ? 'ハイスコアを登録してランキングに参加しよう！' : 'スコアが0のため登録できません。',
      score > 0 ? 'info' : 'warning'
    );

    // ランキング読み込み & フォーム紐付け
    let limit = Number(detail.limit);
    if (!Number.isFinite(limit) || limit <= 0) limit = 10;
    limit = Math.max(1, Math.min(100, Math.floor(limit)));
    renderTop(elems, ctx, limit);
    bindForm(elems, score, ctx);

    // フォーカス誘導
    setTimeout(() => elems?.name?.focus?.(), 150);
  });

  // 非表示イベント
  window.addEventListener('lb:leaderboard:hide', (ev) => {
    const root = ev?.detail?.root;
    const panel = root || document.querySelector('#lb-panel,#lb-embed');
    if (panel) {
      panel.hidden = true;
      panel.removeAttribute('data-active');
    }
  });
})();

  }
})();
