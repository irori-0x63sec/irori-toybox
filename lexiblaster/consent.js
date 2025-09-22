// consent.js — 同意UIと可否APIのみ（ゲームは常時ロード）
// 仕様: 初回は必ずダイアログを開く。選択ボタン押下で確実に閉じる。
// 同意は {choice:'all'|'essential'|'reject', at:number} を localStorage に保存。

(function () {
  const KEY = 'lexiConsent.v1';

  // ---------- 同意状態 ----------
  function getConsent() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null');
      return (v && v.choice) ? v.choice : 'unset';
    } catch { return 'unset'; }
  }
  function setConsent(choice) {
    try { localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() })); } catch {}
  }

  // ---------- 公開API（ゲーム側が使う） ----------
  const Consent = {
    state() { return getConsent(); },
    allow(category) {
      const s = getConsent();
      if (category === 'essential') return true;
      if (category === 'storage')   return s !== 'reject';
      if (category === 'analytics' || category === 'ads') return s === 'all';
      return false;
    },
    onChange(cb) { document.addEventListener('lb:consent', cb); }
  };
  window.lexiConsent = window.lbConsent = Consent;

  // ---------- DOMユーティリティ ----------
  const $id = (id) => document.getElementById(id);

  function openOverlay() {
    const ov = $id('cookie-overlay'); if (!ov) return;
    ov.hidden = false;
    ov.style.display = 'grid';
    ov.setAttribute('aria-modal', 'true');
    ov.setAttribute('role', 'dialog');
    ov.style.position = 'fixed';
    ov.style.inset = '0';
    ov.style.zIndex = '99999';
    ov.style.pointerEvents = 'auto';
  }

  function closeOverlay() {
    const ov = $id('cookie-overlay'); if (!ov) return;
    ov.hidden = true;
    ov.style.display = 'none';
    ov.removeAttribute('aria-modal');
    ov.removeAttribute('role');
  }

  function applyChoice(choice) {
    setConsent(choice);

    // 拒否へ切り替えたら保存物を削除（キーを明示）
    if (choice === 'reject') {
      try { localStorage.removeItem('lb_scores_v1'); } catch {}
      try { localStorage.removeItem('bgmMuted'); } catch {}
      try { localStorage.removeItem('LBBackup'); } catch {}
    }

    // 必ず閉じる
    closeOverlay();

    // 変更通知（計測/広告の遅延ロードはここで反応）
    document.dispatchEvent(new CustomEvent('lb:consent', { detail: { choice } }));
  }

  function bindOnce() {
    const btnAll  = $id('cookie-accept-all');
    const btnEss  = $id('cookie-accept-essential');
    const btnRej  = $id('cookie-reject-all');
    const btnOpen = $id('cookie-open-settings');
    const overlay = $id('cookie-overlay');

    const attach = (el, handler) => {
      if (!el) return;
      const fn = (e) => { e.preventDefault(); e.stopPropagation(); handler(); };
      el.addEventListener('click', fn, { passive: false });
      el.onclick = fn; // 念のため
    };

    attach(btnAll, () => applyChoice('all'));
    attach(btnEss, () => applyChoice('essential'));
    attach(btnRej, () => applyChoice('reject'));
    attach(btnOpen, () => openOverlay());

    // ★ 背景クリックだけを止める（captureは使わない）
    if (overlay) {
      overlay.addEventListener('click', (e) => {
        // 背景（overlay 自身）をクリックした時のみ反応
        if (e.target === overlay) {
          // 閉じる仕様にしたければここで closeOverlay();
          // いまは誤クリック防止のため何もしないで止めるだけ
          e.stopPropagation();
        }
      }); // ← capture: true を使わないことが重要
      // Esc で閉じたい場合は任意で有効化（既存選択があればそれを維持）
      overlay.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeOverlay();
        }
      });
    }
  }

  function init() {
    bindOnce();

    // 初回は必ず開く（「unset」ならモーダルを表示）
    if (getConsent() === 'unset') {
      openOverlay();
    } else {
      closeOverlay(); // 二重表示防止
    }

    // フッターの再表示リンクは常に表示
    const footer = $id('cookie-footer-link');
    if (footer) footer.hidden = false;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
