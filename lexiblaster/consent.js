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
  function qs(sel) { return document.querySelector(sel); }
  function setLS(val) {
    try { localStorage.setItem(KEY, JSON.stringify(val)); } catch {}
  }
  function getLS() {
    try {
      const v = localStorage.getItem(KEY);
      return v ? JSON.parse(v) : null;
    } catch { return null; }
  }
  function setCookie(name, value, days = 180) {
    const d = new Date();
    d.setTime(d.getTime() + days*24*60*60*1000);
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
    // キャンバスを再表示したい場合の補助（visibility を main 側で制御しているなら無視されます）
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
    // ゲーム側がフックしやすいようにイベント発火（既存の機能は壊さない）
    document.dispatchEvent(new CustomEvent('lexi:consent', { detail: choice }));
    if (typeof window.__onConsentDecided === 'function') {
      try { window.__onConsentDecided(choice); } catch {}
    }
  }

  // ---- decide & close ----
  function decideAndClose(status) {
    // status: 'all' | 'essential' | 'reject'
    const payload = { status, ts: Date.now(), ver: 1 };
    setLS(payload);
    setCookie(COOKIE, status);
    hideOverlay();
    dispatchConsent(payload);
  }

  // ---- bind buttons (必ず閉じる) ----
  function bind() {
    const a = qs(SELECTORS.acceptAll);
    const e = qs(SELECTORS.acceptEssential);
    const r = qs(SELECTORS.rejectAll);
    const ov = qs(SELECTORS.overlay);

    // いずれのボタンも必ず閉じる
    if (a) a.addEventListener('click', () => decideAndClose('all'));
    if (e) e.addEventListener('click', () => decideAndClose('essential'));
    if (r) r.addEventListener('click', () => decideAndClose('reject'));

    // バックドロップクリックでは閉じない（必須選択のため）
    if (ov) {
      ov.addEventListener('click', (ev) => {
        // カード外クリックでも閉じないよう阻止（カード自体のクリックは伝播止め）
        // もし将来カードに .cookie-card があるなら、ここで判定してもOK
        // ev.stopPropagation(); ← オーバーレイ全体なので不要
      }, true);
    }

    // 再設定（任意）: フッタリンクがある場合
    const reopen = qs(SELECTORS.reopenLink);
    if (reopen) {
      reopen.addEventListener('click', () => {
        showOverlay();
      });
    }
  }

  // ---- init ----
  document.addEventListener('DOMContentLoaded', () => {
    bind();

    // すでに同意済みなら即非表示
    const saved = getLS() || getCookie(COOKIE);
    if (saved) {
      hideOverlay();
      // 既存の起動フローに合わせてイベントだけ飛ばす
      const status = typeof saved === 'string' ? saved : saved.status;
      dispatchConsent({ status, ts: Date.now(), ver: 1, restored: true });
    } else {
      // 未同意なら表示してブロック
      showOverlay();
    }
  });
})();
