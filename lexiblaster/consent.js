// 保存先: localStorage('lexiConsent') + cookie('_lexi_consent')
// 期待する要素ID: cookieOverlay, btn-accept-all, btn-accept-essential, btn-reject-all
(function () {
  'use strict';

  const KEY = 'lexiConsent';
  const COOKIE = '_lexi_consent';
  const SELECTORS = {
    overlay:  '#cookieOverlay',
    acceptAll: '#btn-accept-all',
    acceptEssential: '#btn-accept-essential',
    rejectAll: '#btn-reject-all',
    // （任意）再設定リンクがある場合
    reopenLink: '.cookie-footer-link .linklike'
  };

  // ---- utils ----
  const qs  = (sel) => document.querySelector(sel);
  const qsa = (sel) => Array.from(document.querySelectorAll(sel));

  function setLS(val) { try { localStorage.setItem(KEY, JSON.stringify(val)); } catch {} }
  function getLS() {
    try { const v = localStorage.getItem(KEY); return v ? JSON.parse(v) : null; }
    catch { return null; }
  }
  function setCookie(name, value, days = 180) {
    const d = new Date(); d.setTime(d.getTime() + days*24*60*60*1000);
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
  }
  function getCookie(name) {
    const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
    return m ? decodeURIComponent(m[1]) : null;
  }

  function hideOverlay() {
    const ov = qs(SELECTORS.overlay);
    if (!ov) return;
    ov.style.display = 'none';
    ov.setAttribute('aria-hidden', 'true');
    const canvas = document.getElementById('gameCanvas');
    if (canvas) canvas.style.pointerEvents = 'auto';
  }
  function showOverlay() {
    const ov = qs(SELECTORS.overlay);
    if (!ov) return;
    ov.style.display = 'grid';
    ov.removeAttribute('aria-hidden');
    const canvas = document.getElementById('gameCanvas');
    if (canvas) canvas.style.pointerEvents = 'none';
  }

  function dispatchConsent(choice) {
    document.dispatchEvent(new CustomEvent('lexi:consent', { detail: choice }));
    if (typeof window.__onConsentDecided === 'function') {
      try { window.__onConsentDecided(choice); } catch {}
    }
  }

  function decideAndClose(status) {
    const payload = { status, ts: Date.now(), ver: 1 };
    setLS(payload);
    setCookie(COOKIE, status);
    hideOverlay();
    dispatchConsent(payload);
  }

  // ---- bind buttons（直接バインド＋委譲の二段構え）----
  function bind() {
    const ov = qs(SELECTORS.overlay);

    // 直接バインド
    const a = qs(SELECTORS.acceptAll);
    const e = qs(SELECTORS.acceptEssential);
    const r = qs(SELECTORS.rejectAll);
    if (a) a.addEventListener('click', (ev) => { ev.preventDefault(); decideAndClose('all'); });
    if (e) e.addEventListener('click', (ev) => { ev.preventDefault(); decideAndClose('essential'); });
    if (r) r.addEventListener('click', (ev) => { ev.preventDefault(); decideAndClose('reject'); });

    // イベント委譲（ID が正しければ確実に反応）
    if (ov) {
      ov.addEventListener('click', (ev) => {
        const t = ev.target;
        if (t.closest(SELECTORS.acceptAll))      { ev.preventDefault(); decideAndClose('all');       return; }
        if (t.closest(SELECTORS.acceptEssential)){ ev.preventDefault(); decideAndClose('essential');  return; }
        if (t.closest(SELECTORS.rejectAll))      { ev.preventDefault(); decideAndClose('reject');     return; }
        // バックドロップクリックでは閉じない（必須選択）
      }, true);
    }

    // 再設定（任意）
    const reopen = qs(SELECTORS.reopenLink);
    if (reopen) reopen.addEventListener('click', (e) => { e.preventDefault(); showOverlay(); });
  }

  function init() {
    bind();

    // 既に同意済みなら即閉じる（イベントは飛ばす）
    const saved = getLS() || getCookie(COOKIE);
    if (saved) {
      hideOverlay();
      const status = typeof saved === 'string' ? saved : saved.status;
      dispatchConsent({ status, ts: Date.now(), ver: 1, restored: true });
    } else {
      showOverlay();
    }
  }

  // DOM 準備前後どちらでも初期化されるように
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
