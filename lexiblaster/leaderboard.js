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
    'https://lexiblaster-leaderboard.irori-toybox.workers.dev'
  ].filter(Boolean);

  const API_BASE = (function pickBase(){
    for (const candidate of baseCandidates) {
      const normalized = sanitizeBase(candidate);
      if (normalized) return normalized;
    }
    return '';
  })();

  const state = {
    root: null,
    elements: null,
    mounted: false,
    finalScore: 0,
    meta: {},
    statusLockUntil: 0,
    isSubmitting: false,
    limit: 10,
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
    state.meta = detail.meta || {};
    state.limit = Number.isFinite(detail.limit) && detail.limit > 0 ? Math.floor(detail.limit) : 10;
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

    const canSubmit = !!API_BASE && state.finalScore > 0;
    prepareForm(canSubmit);

    if (state.finalScore <= 0) {
      setStatus('スコアが0のため登録できません。次回の挑戦をお待ちしています。', 'warning', { force: true, holdMs: 4000 });
    } else if (!API_BASE) {
      setStatus('ランキングサーバーに接続できません。時間をおいて再度お試しください。', 'warning', { force: true, holdMs: 5000 });
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

    if (!API_BASE) {
      setStatus('現在ランキングサーバーに接続できません。時間をおいて再度お試しください。', 'error', { force: true, holdMs: 4000 });
      return;
    }

    const nameRaw = state.elements.nameInput?.value ?? '';
    const name = sanitizeName(nameRaw);
    const score = clampScore(state.finalScore);

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
      await submitScore(name, score);
      saveStoredName(name);
      state.lastSubmission = { name, score };
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
    const limit = Number.isFinite(options.limit) && options.limit > 0 ? Math.floor(options.limit) : state.limit;

    if (!API_BASE) {
      updateTable([]);
      if (!options.silent) {
        setStatus('ランキングサーバーに接続できません。時間をおいて再度お試しください。', 'warning', { force: true, holdMs: 5000 });
      }
      return [];
    }

    if (!options.silent) {
      setStatus('ランキングを読み込み中…', 'loading');
    }

    try {
      const entries = await fetchLeaderboard(limit);
      state.cachedEntries = entries;
      updateTable(entries);
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
      setStatus('ランキングを取得できませんでした。時間をおいて再度お試しください。', 'error', { force: true, holdMs: 5000 });
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
      if (state.lastSubmission && entry.name === state.lastSubmission.name && entry.score === state.lastSubmission.score) {
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

  function collectElements(root){
    return {
      root,
      status: root.querySelector('#lb-leaderboard-status'),
      form: root.querySelector('#lb-leaderboard-form'),
      nameInput: root.querySelector('#lb-leaderboard-name'),
      submitButton: root.querySelector('#lb-leaderboard-submit'),
      table: root.querySelector('#lb-leaderboard-table'),
      tableBody: root.querySelector('#lb-leaderboard-body'),
      emptyMessage: root.querySelector('#lb-leaderboard-empty'),
    };
  }

  function setStatus(message, type = 'info', { force = false, holdMs = 0 } = {}){
    if (!state.elements?.status) return;
    const el = state.elements.status;
    const now = Date.now();
    if (!force && state.statusLockUntil && now < state.statusLockUntil) {
      return;
    }
    state.statusLockUntil = holdMs > 0 ? now + holdMs : 0;
    el.textContent = message || '';
    el.hidden = false;
    for (const cls of STATUS_CLASSES) el.classList.remove(cls);
    if (type) el.classList.add(`lb-status--${type}`);
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

  async function submitScore(name, score){
    const payload = {
      name: sanitizeName(name),
      score: clampScore(score)
    };
    if (!payload.name) throw new Error('NAME_REQUIRED');
    if (!(payload.score > 0)) throw new Error('SCORE_REQUIRED');
    const res = await fetch(buildUrl('/submit'), {
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

  async function fetchLeaderboard(limit = 10){
    const url = new URL(buildUrl('/top'));
    if (Number.isFinite(limit) && limit > 0) {
      url.searchParams.set('limit', Math.floor(limit));
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
      refresh: (limit) => refreshLeaderboard({ limit, silent: false }),
      getLastSubmission: () => state.lastSubmission ? { ...state.lastSubmission } : null,
      get apiBase(){ return API_BASE; },
      get maxNameLength(){ return MAX_NAME_LENGTH; },
      get maxScore(){ return MAX_SCORE; }
    };
  }
})();
