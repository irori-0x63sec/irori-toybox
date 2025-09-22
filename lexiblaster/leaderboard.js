(function(){
  'use strict';

  const MAX_NAME_LENGTH = 12;
  const MAX_SCORE = 999999;
  const STORAGE_KEY = 'lb_last_handle_v1';
  const STATUS_CLASSES = ['lb-status--info','lb-status--loading','lb-status--success','lb-status--error','lb-status--warning'];

  const scriptEl = document.currentScript;
  const baseCandidates = [
    typeof window !== 'undefined' ? (window.LEXI_LEADERBOARD_BASE || window.LEXI_LEADERBOARD_ENDPOINT || window.LEADERBOARD_API_BASE) : null,
    scriptEl?.dataset?.apiBase,
    scriptEl?.dataset?.endpoint,
    scriptEl?.dataset?.base,
    typeof location !== 'undefined' ? `${location.origin}/api/leaderboard` : null,
    'https://lb.irori-toybox.com'
  ].filter(Boolean);

  const API_BASE = (function pickBase(){
    for (const candidate of baseCandidates) {
      const normalized = sanitizeBase(candidate);
      if (normalized) return normalized;
    }
    return '';
  })();

  const DEFAULT_GAME = 'lexi-blaster';
  const DEFAULT_CONTEXT = Object.freeze({ game: DEFAULT_GAME, mode: 'en_en', level: 'A1' });
  const ALLOWED_GAMES = Object.freeze([DEFAULT_GAME]);
  const ALLOWED_MODES = Object.freeze(['en_en','jp_en','en_jp']);
  const ALLOWED_LEVELS = Object.freeze(['A1','A2','A3','B1','B2','B3','C1','C2','C3']);
  const MODE_LABELS = Object.freeze({
    en_en: 'EN→EN',
    jp_en: 'JP→EN',
    en_jp: 'EN→JP',
  });
  const ALLOWED_GAME_SET = new Set(ALLOWED_GAMES);
  const ALLOWED_MODE_SET = new Set(ALLOWED_MODES);
  const ALLOWED_LEVEL_SET = new Set(ALLOWED_LEVELS);

  const state = {
    root: null,
    elements: null,
    mounted: false,
    finalScore: 0,
    meta: {},
    context: null,
    contextKey: '',
    statusLockUntil: 0,
    isSubmitting: false,
    limit: 20,
    lastSubmission: null,
    formHandler: null,
    cachedEntries: [],
  };

  window.addEventListener('lb:leaderboard:show', onShow);
  window.addEventListener('lb:leaderboard:hide', onHide);

  function onShow(event){
    const detail = event?.detail || {};
    const root = detail.root;
    if (!root) return;
    state.root = root;
    state.elements = collectElements(root);
    state.finalScore = clampScore(detail.total);
    const incomingMeta = detail.meta && typeof detail.meta === 'object' ? detail.meta : {};
    state.meta = { ...incomingMeta };
    state.context = normalizeContext({ ...incomingMeta }, DEFAULT_CONTEXT, { strict: true });
    state.contextKey = makeContextKey(state.context);
    if (state.context && !state.meta.mode) state.meta.mode = state.context.mode;
    if (state.context && !state.meta.levelName) state.meta.levelName = state.context.level;
    if (!state.meta.modeLabel && state.meta.mode) state.meta.modeLabel = describeMode(state.meta.mode);
    state.limit = Number.isFinite(detail.limit) && detail.limit > 0 ? Math.floor(detail.limit) : 20;
    mount();
  }

  function onHide(){
    if (!state.mounted) return;
    detach();
  }

  function mount(){
    if (!state.elements) return;
    state.mounted = true;
    state.root.hidden = false;
    state.root.setAttribute('data-active', '1');
    state.statusLockUntil = 0;

    const savedName = loadStoredName();
    if (savedName && state.elements.nameInput && !state.elements.nameInput.value) {
      state.elements.nameInput.value = savedName;
    }

    updateHeadings();

    const canSubmit = !!API_BASE && state.finalScore > 0 && !!state.context;
    prepareForm(canSubmit);

    if (state.finalScore <= 0) {
      setStatus('スコアが0のため登録できません。次回の挑戦をお待ちしています。', 'warning', { force: true, holdMs: 4000 });
    } else if (!API_BASE || !state.context) {
      setStatus('ランキングを取得できませんでした。', 'error', { force: true, holdMs: 5000 });
    } else if (state.meta?.personalBest) {
      setStatus('自己ベスト更新！ランキングに登録してシェアしよう。', 'info', { force: true, holdMs: 4000 });
    } else {
      setStatus('ハイスコアを登録してランキングに参加しよう！', 'info');
    }

    refreshLeaderboard({ silent: false }).catch(()=>{});

    if (canSubmit && state.elements.nameInput) {
      setTimeout(() => {
        try {
          if (state.mounted && state.elements?.nameInput && !state.elements.nameInput.value) {
            state.elements.nameInput.focus();
          }
        } catch {}
      }, 220);
    }
  }

  function detach(){
    if (state.formHandler && state.elements?.form) {
      state.elements.form.removeEventListener('submit', state.formHandler);
    }
    state.formHandler = null;
    if (state.root) {
      state.root.hidden = true;
      state.root.removeAttribute('data-active');
    }
    state.elements = null;
    state.root = null;
    state.mounted = false;
    state.statusLockUntil = 0;
    state.context = null;
    state.contextKey = '';
    state.meta = {};
  }

  function prepareForm(canSubmit){
    if (!state.elements) return;
    const { form, submitButton } = state.elements;
    if (!form) return;

    const handler = (event) => {
      event.preventDefault();
      handleSubmit().catch(()=>{});
    };

    if (state.formHandler) {
      form.removeEventListener('submit', state.formHandler);
    }
    state.formHandler = handler;
    form.addEventListener('submit', handler);

    if (submitButton) {
      submitButton.disabled = !canSubmit;
    }
  }

  async function handleSubmit(){
    if (!state.mounted || !state.elements) return;
    if (state.isSubmitting) return;

    if (!API_BASE || !state.context) {
      setStatus('ランキングを取得できませんでした。', 'error', { force: true, holdMs: 4000 });
      return;
    }

    const nameRaw = state.elements.nameInput?.value ?? '';
    const name = sanitizeName(nameRaw);
    const score = clampScore(state.finalScore);
    const context = resolveContext(null, { allowFallback: false, strict: true });
    if (!context) {
      setStatus('ランキングを取得できませんでした。', 'error', { force: true, holdMs: 4000 });
      return;
    }

    if (!name) {
      setStatus('ハンドルネームは1〜12文字で入力してください。', 'warning', { force: true, holdMs: 4000 });
      state.elements.nameInput?.focus();
      return;
    }
    if (score <= 0) {
      setStatus('スコアが0のため登録できません。', 'warning', { force: true, holdMs: 4000 });
      return;
    }

    state.isSubmitting = true;
    if (state.elements.submitButton) state.elements.submitButton.disabled = true;
    setStatus('スコア送信中…', 'loading', { force: true });

    try {
      const submission = await submitScore(name, score, context);
      saveStoredName(name);
      const rankValue = Number.isFinite(submission?.rank) && submission.rank > 0 ? Math.floor(submission.rank) : null;
      const contextKey = makeContextKey(context);
      state.lastSubmission = { name, score, rank: rankValue, contextKey };
      setStatus('ランキングに登録しました！', 'success', { force: true, holdMs: 5000 });
      await refreshLeaderboard({ silent: true });
    } catch (err) {
      console.error('[Leaderboard] submit failed', err);
      setStatus('送信に失敗しました。通信環境をご確認ください。', 'error', { force: true, holdMs: 5000 });
    } finally {
      state.isSubmitting = false;
      if (state.elements?.submitButton) {
        state.elements.submitButton.disabled = false;
      }
    }
  }

  async function refreshLeaderboard(options = {}){
    if (!state.mounted || !state.elements) return [];
    updateHeadings();

    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : state.limit;
    const context = resolveContext(null, { allowFallback: false, strict: true });
    const contextKey = makeContextKey(context);
    if (context) {
      state.context = context;
      state.contextKey = contextKey;
    }
    const highlight = (state.lastSubmission && state.lastSubmission.contextKey && state.lastSubmission.contextKey === contextKey)
      ? { name: state.lastSubmission.name, score: state.lastSubmission.score, rank: state.lastSubmission.rank }
      : null;
    const verticalRoot = state.elements.verticalRoot;
    const verticalList = state.elements.verticalList;
    const verticalStatus = state.elements.verticalStatus;

    if (!options.silent && verticalStatus) {
      if (verticalRoot) verticalRoot.hidden = false;
      if (verticalList) verticalList.innerHTML = '';
      applyStatus(verticalStatus, 'ランキングを読み込み中…', 'loading');
    }

    if (!API_BASE || !context) {
      updateTable([]);
      state.cachedEntries = [];
      if (verticalRoot || verticalStatus) {
        renderVerticalList(verticalRoot, [], {
          list: verticalList,
          status: verticalStatus,
          limit,
          highlight,
          emptyMessage: 'ランキングを取得できませんでした。',
          emptyStatusType: 'error'
        });
      }
      if (!options.silent) {
        setStatus('ランキングを取得できませんでした。', 'error', { force: true, holdMs: 5000 });
      }
      return [];
    }

    if (!options.silent) {
      setStatus('ランキングを読み込み中…', 'loading');
    }

    try {
      const entries = await fetchLeaderboard(limit, context, { allowFallback: false, strict: true });
      state.cachedEntries = entries;
      updateTable(entries);
      if (verticalRoot || verticalStatus) {
        renderVerticalList(verticalRoot, entries, {
          list: verticalList,
          status: verticalStatus,
          limit,
          highlight,
        });
      }
      if (!options.silent) {
        const allowOverride = !state.statusLockUntil || Date.now() >= state.statusLockUntil;
        const message = entries.length === 0
          ? 'まだ登録がありません。最初の挑戦者になろう！'
          : '最新のランキングを表示しています。';
        setStatus(message, 'info', { force: allowOverride });
      }
      return entries;
    } catch (err) {
      console.error('[Leaderboard] fetch failed', err);
      updateTable([]);
      state.cachedEntries = [];
      if (verticalRoot || verticalStatus) {
        renderVerticalList(verticalRoot, [], {
          list: verticalList,
          status: verticalStatus,
          limit,
          highlight,
          emptyMessage: 'ランキングを取得できませんでした。',
          emptyStatusType: 'error'
        });
      }
      setStatus('ランキングを取得できませんでした。', 'error', { force: true, holdMs: 5000 });
      return [];
    }
  }

  function updateTable(entries){
    if (!state.elements) return;
    const { tableBody, table, emptyMessage } = state.elements;
    if (!tableBody) return;

    tableBody.innerHTML = '';

    if (!Array.isArray(entries) || entries.length === 0) {
      if (table) table.style.display = 'none';
      if (emptyMessage) emptyMessage.hidden = false;
      return;
    }

    if (table) table.style.display = '';
    if (emptyMessage) emptyMessage.hidden = true;

    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      const tr = document.createElement('tr');
      if (isSelfEntry(entry)) {
        tr.classList.add('lb-row-self');
      }

      const rankTd = document.createElement('td');
      rankTd.textContent = `${entry.rank ?? ''}`;
      const nameTd = document.createElement('td');
      nameTd.textContent = entry.displayName || '名無し';
      const scoreTd = document.createElement('td');
      scoreTd.textContent = formatScore(entry.score);

      tr.append(rankTd, nameTd, scoreTd);
      fragment.appendChild(tr);
    }

    tableBody.appendChild(fragment);
  }

  function isSelfEntry(entry){
    if (!state.lastSubmission) return false;
    if (state.lastSubmission.contextKey && state.lastSubmission.contextKey !== state.contextKey) return false;
    const { name, score, rank } = state.lastSubmission;
    if (!name) return false;
    if (entry.name !== name) return false;
    if (Number.isFinite(score) && entry.score !== score) return false;
    if (Number.isFinite(rank) && rank > 0 && entry.rank !== rank) return false;
    return true;
  }

  function collectElements(root){
    return {
      root,
      status: root.querySelector('#lb-leaderboard-status'),
      heading: root.querySelector('#lb-leaderboard-heading'),
      form: root.querySelector('#lb-leaderboard-form'),
      nameInput: root.querySelector('#lb-leaderboard-name'),
      submitButton: root.querySelector('#lb-leaderboard-submit'),
      table: root.querySelector('#lb-leaderboard-table'),
      tableBody: root.querySelector('#lb-leaderboard-body'),
      emptyMessage: root.querySelector('#lb-leaderboard-empty'),
      verticalRoot: root.querySelector('#lb-vertical'),
      verticalList: root.querySelector('#lb-vertical-list'),
      verticalStatus: root.querySelector('#lb-vertical-status'),
      verticalHeading: root.querySelector('#lb-vertical-heading'),
    };
  }

  function updateHeadings(){
    if (!state.elements) return;
    const heading = state.elements.heading;
    const verticalHeading = state.elements.verticalHeading;
    const context = state.context;
    const levelLabel = context?.level || state.meta?.levelName || '';
    const modeLabel = state.meta?.modeLabel || (context?.mode ? describeMode(context.mode) : '');
    const combined = levelLabel && modeLabel
      ? `${levelLabel} / ${modeLabel}`
      : (levelLabel || modeLabel || '');
    if (heading) {
      heading.textContent = combined ? `ランキング（${combined}）` : 'ランキング';
    }
    if (verticalHeading) {
      verticalHeading.textContent = combined ? `TOP 20（${combined}）` : 'TOP 20';
    }
  }

  function setStatus(message, type = 'info', { force = false, holdMs = 0, target = null } = {}){
    const el = target ?? state.elements?.status;
    if (!el) return;
    const isMain = !target || el === state.elements?.status;
    const now = Date.now();
    if (isMain && !force && state.statusLockUntil && now < state.statusLockUntil) {
      return;
    }
    if (isMain) {
      state.statusLockUntil = holdMs > 0 ? now + holdMs : 0;
    }
    applyStatus(el, message, type);
  }

  function applyStatus(el, message, type = 'info'){
    if (!el) return;
    el.textContent = message || '';
    el.hidden = !message;
    for (const cls of STATUS_CLASSES) el.classList.remove(cls);
    if (message && type) el.classList.add(`lb-status--${type}`);
  }

  function sanitizeName(name){
    if (typeof name !== 'string') name = '';
    let cleaned = name.replace(/[\u0000-\u001F\u007F]/g, '').trim();
    cleaned = cleaned.replace(/\s+/g, ' ');
    if (cleaned.length > MAX_NAME_LENGTH) cleaned = cleaned.slice(0, MAX_NAME_LENGTH);
    return cleaned;
  }

  function clampScore(value){
    const num = Math.round(Number(value) || 0);
    if (!Number.isFinite(num) || num < 0) return 0;
    return Math.min(num, MAX_SCORE);
  }

  function resolveContext(metaOverride = null, options = {}){
    const allowFallback = !!options.allowFallback;
    const strict = options.strict !== undefined ? !!options.strict : true;
    const fallback = allowFallback ? DEFAULT_CONTEXT : state.context;
    const normalized = normalizeContext(metaOverride || {}, fallback, { strict });
    if (normalized) return normalized;
    if (allowFallback) {
      const fallbackNormalized = normalizeContext(DEFAULT_CONTEXT, DEFAULT_CONTEXT, { strict: false });
      if (fallbackNormalized) return fallbackNormalized;
    }
    return null;
  }

  function normalizeContext(meta = {}, fallback = DEFAULT_CONTEXT, { strict = false } = {}){
    const fallbackGame = sanitizeGame(fallback?.game) || DEFAULT_GAME;
    const fallbackMode = sanitizeMode(fallback?.mode);
    const fallbackLevel = sanitizeLevel(fallback?.level);

    const rawGame = sanitizeGame(meta?.game);
    const rawMode = sanitizeMode(meta?.mode);
    const rawLevel = sanitizeLevel(meta?.level);

    const mode = rawMode || (!strict ? fallbackMode : '');
    const level = rawLevel || (!strict ? fallbackLevel : '');
    if (!mode || !level) return null;

    const game = rawGame || fallbackGame || DEFAULT_GAME;
    if (!ALLOWED_GAME_SET.has(game)) return null;
    return { game, mode, level };
  }

  function sanitizeGame(value){
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    if (!normalized) return '';
    return ALLOWED_GAME_SET.has(normalized) ? normalized : '';
  }

  function sanitizeMode(value){
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toLowerCase();
    return ALLOWED_MODE_SET.has(normalized) ? normalized : '';
  }

  function sanitizeLevel(value){
    if (typeof value !== 'string') return '';
    const normalized = value.trim().toUpperCase();
    return ALLOWED_LEVEL_SET.has(normalized) ? normalized : '';
  }

  function describeMode(modeKey){
    if (!modeKey) return '';
    return MODE_LABELS[modeKey] || modeKey.toUpperCase().replace('_', '→');
  }

  function makeContextKey(context){
    if (!context) return '';
    return `${context.game}::${context.mode}::${context.level}`;
  }

  async function submitScore(name, score, metaOverride = null, options = {}){
    const context = resolveContext(metaOverride, { allowFallback: !!options.allowFallback, strict: options.strict !== undefined ? !!options.strict : true });
    if (!context) throw new Error('CONTEXT_REQUIRED');
    const payload = {
      game: context.game,
      mode: context.mode,
      level: context.level,
      name: sanitizeName(name),
      score: clampScore(score)
    };
    if (!payload.name) throw new Error('NAME_REQUIRED');
    if (!(payload.score > 0)) throw new Error('SCORE_REQUIRED');
    const res = await fetch(buildUrl('/score'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      mode: 'cors',
      credentials: 'omit',
      keepalive: true,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Submit failed (${res.status}) ${text}`.trim());
    }
    try {
      return await res.json();
    } catch {
      return { ok: true };
    }
  }

  async function fetchLeaderboard(limit = 10, metaOverride = null, options = {}){
    const context = resolveContext(metaOverride, { allowFallback: !!options.allowFallback, strict: options.strict !== undefined ? !!options.strict : true });
    if (!context) throw new Error('CONTEXT_REQUIRED');
    const url = new URL(buildUrl('/top'));
    url.searchParams.set('game', context.game);
    url.searchParams.set('mode', context.mode);
    url.searchParams.set('level', context.level);
    if (Number.isFinite(limit) && limit > 0) {
      const capped = Math.min(Math.floor(limit), 100);
      url.searchParams.set('limit', capped);
    }
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Fetch failed (${res.status}) ${text}`.trim());
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }
    const list = Array.isArray(data) ? data : (data?.results || data?.top || data?.items || data?.data || []);
    const normalized = normalizeEntries(list, limit);
    return normalized;
  }

  function normalizeEntries(list, limit){
    const entries = [];
    if (Array.isArray(list)) {
      for (const item of list) {
        const entry = normalizeEntry(item);
        if (entry.score > 0 || entry.name) {
          entries.push(entry);
        }
      }
    }
    entries.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const ta = Number.isFinite(a.timestamp) ? a.timestamp : Infinity;
      const tb = Number.isFinite(b.timestamp) ? b.timestamp : Infinity;
      return ta - tb;
    });
    const max = Number.isFinite(limit) && limit > 0 ? Math.min(entries.length, Math.floor(limit)) : entries.length;
    for (let i = 0; i < max; i++) {
      entries[i].rank = i + 1;
    }
    if (entries.length > max) {
      entries.length = max;
    }
    return entries;
  }

  function normalizeEntry(item){
    const score = clampScore(item?.score);
    const timestamp = Number(item?.timestamp);
    const rank = Number(item?.rank);
    const name = sanitizeName(typeof item?.name === 'string' ? item.name : '');
    return {
      name,
      displayName: name || '名無し',
      score,
      timestamp: Number.isFinite(timestamp) ? timestamp : null,
      rank: Number.isFinite(rank) && rank > 0 ? rank : null,
    };
  }

  function formatScore(value){
    try {
      return Number(value || 0).toLocaleString('ja-JP');
    } catch {
      return String(value ?? 0);
    }
  }

  function renderVerticalList(root, entries, options = {}){
    const statusEl = options.status ?? root?.querySelector('.lb-status');
    const listEl = options.list ?? root?.querySelector('ol, ul');
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : null;
    const highlight = options.highlight ?? null;

    if (root) {
      root.hidden = false;
    }
    if (listEl) {
      listEl.innerHTML = '';
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      const emptyMessage = options.emptyMessage ?? 'まだ登録がありません。最初の挑戦者になろう！';
      const emptyType = options.emptyStatusType ?? 'info';
      applyStatus(statusEl, emptyMessage, emptyType);
      return;
    }

    applyStatus(statusEl, '', 'info');

    const highlightName = highlight?.name ? sanitizeName(highlight.name) : '';
    const highlightScore = Number.isFinite(highlight?.score) ? clampScore(highlight.score) : null;
    const highlightRank = Number.isFinite(highlight?.rank) && highlight.rank > 0 ? Math.floor(highlight.rank) : null;

    const fragment = document.createDocumentFragment();
    const max = limit ? Math.min(limit, entries.length) : entries.length;

    for (let i = 0; i < max; i++) {
      const entry = entries[i];
      const li = document.createElement('li');
      const rankValue = Number.isFinite(entry?.rank) && entry.rank > 0 ? entry.rank : (i + 1);

      const rankSpan = document.createElement('span');
      rankSpan.className = 'lb-rank';
      rankSpan.textContent = `${rankValue}位`;

      const nameSpan = document.createElement('span');
      nameSpan.className = 'lb-name';
      nameSpan.textContent = entry?.displayName || '名無し';

      const scoreSpan = document.createElement('span');
      scoreSpan.className = 'lb-score';
      scoreSpan.textContent = `${formatScore(entry?.score)}pt`;

      li.append(rankSpan, nameSpan, scoreSpan);

      if (highlightName) {
        const matchName = entry?.name === highlightName;
        const matchScore = highlightScore === null || entry?.score === highlightScore;
        const matchRank = highlightRank === null || entry?.rank === highlightRank;
        if (matchName && matchScore && matchRank) {
          li.classList.add('lb-row-self');
        }
      }

      fragment.appendChild(li);
    }

    if (listEl) {
      listEl.appendChild(fragment);
    }
  }

  function sanitizeBase(value){
    if (!value) return '';
    try {
      const url = new URL(value, typeof location !== 'undefined' ? location.origin : 'https://example.com');
      if (!/^https?:$/i.test(url.protocol)) return '';
      const path = url.pathname.replace(/\/+$/g, '');
      return `${url.origin}${path}`;
    } catch {
      return '';
    }
  }

  function buildUrl(path){
    if (!API_BASE) throw new Error('Leaderboard API base is not configured');
    const normalizedPath = (path || '').replace(/^\/+/, '');
    return new URL(normalizedPath, `${API_BASE}/`).toString();
  }

  let storageAllowed = null;
  function storageEnabled(){
    if (storageAllowed !== null) return storageAllowed;
    try {
      const key = '__lb_test__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      storageAllowed = true;
    } catch {
      storageAllowed = false;
    }
    return storageAllowed;
  }

  function loadStoredName(){
    if (!storageEnabled()) return '';
    try {
      return window.localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  }

  function saveStoredName(name){
    if (!storageEnabled()) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, sanitizeName(name));
    } catch {}
  }

  if (typeof window !== 'undefined') {
    window.lexiLeaderboard = {
      submitScore,
      fetchLeaderboard,
      sanitizeName,
      clampScore,
      renderVerticalList: (root, entries, options) => renderVerticalList(root, entries, options),
      setStatusElement: (el, message, type) => applyStatus(el, message, type),
      refresh: (limit) => refreshLeaderboard({ limit, silent: false }),
      getLastSubmission: () => state.lastSubmission ? { ...state.lastSubmission } : null,
      describeMode,
      normalizeContext: (meta, fallback, opts) => normalizeContext(meta, fallback, opts),
      get defaultContext(){ return { ...DEFAULT_CONTEXT }; },
      get allowedModes(){ return [...ALLOWED_MODES]; },
      get allowedLevels(){ return [...ALLOWED_LEVELS]; },
      get allowedGames(){ return [...ALLOWED_GAMES]; },
      get apiBase(){ return API_BASE; },
      get maxNameLength(){ return MAX_NAME_LENGTH; },
      get maxScore(){ return MAX_SCORE; }
    };
  }
})();
