// consent.js（確実に閉じる版）
(function () {
  const KEY = 'lexiConsent.v1';
  const SCRIPTS = ['canvas.js', 'score.js', 'main.js'];

  const $id = (id) => document.getElementById(id);

  function loadGameScripts() {
    if (document.querySelector('script[data-lexi-game="1"]')) return;
    for (const src of SCRIPTS) {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.dataset.lexiGame = '1';
      document.body.appendChild(s);
    }
  }

  function hardHideOverlay(overlay) {
    if (!overlay) return;
    try { overlay.remove(); } catch (_) {}
    try { overlay.hidden = true; } catch (_) {}
    try { overlay.style.display = 'none'; } catch (_) {}
  }

  function applyChoice(choice) {
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() }));
    } catch (_) {}

    const overlay = $id('cookie-overlay');
    hardHideOverlay(overlay);

    const footer = $id('cookie-footer-link');
    if (footer) footer.hidden = false;

    loadGameScripts();
  }

  function ensureOverlayInteractive(overlay) {
    if (!overlay) return;
    // クリックが下に抜けないように強制
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '99999';
    overlay.style.pointerEvents = 'auto';
  }

  window.addEventListener('DOMContentLoaded', () => {
    const overlay = $id('cookie-overlay');
    const btnAll  = $id('cookie-accept-all');
    const btnEss  = $id('cookie-accept-essential');
    const btnRej  = $id('cookie-reject-all');
    const footer  = $id('cookie-footer-link');
    const reopen  = $id('cookie-open-settings');

    // 既に選択済みならオーバーレイ出さずゲーム読み込み
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (saved && saved.choice) {
      hardHideOverlay(overlay);
      if (footer) footer.hidden = false;
      loadGameScripts();
      return;
    }

    // 未選択 → 強制的にオーバーレイを前面・クリック可能に
    if (overlay) {
      overlay.hidden = false;
      overlay.style.display = 'block';
      ensureOverlayInteractive(overlay);

      // ボタン直付け（競合対策で stop/prev）
      const attach = (el, handler) => {
        if (!el) return;
        el.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          handler();
        }, { passive: false });
        // 念のため onclick も登録（二重実行は防ぐ）
        el.onclick = (e) => { e.preventDefault(); e.stopPropagation(); handler(); };
      };

      attach(btnAll, () => applyChoice('all'));
      attach(btnEss, () => applyChoice('essential'));
      attach(btnRej, () => applyChoice('reject'));

      // イベント委任（何かの理由で上が拾えない場合の保険）
      overlay.addEventListener('click', (e) => {
        const t = e.target;
        if (!t || !t.id) return;
        if (t.id === 'cookie-accept-all')       { e.preventDefault(); e.stopPropagation(); applyChoice('all'); }
        else if (t.id === 'cookie-accept-essential') { e.preventDefault(); e.stopPropagation(); applyChoice('essential'); }
        else if (t.id === 'cookie-reject-all')  { e.preventDefault(); e.stopPropagation(); applyChoice('reject'); }
      }, { passive: false, capture: true });

      // オーバーレイ自体のクリックはキャンセル（背面に抜けないように）
      overlay.addEventListener('click', (e) => {
        e.stopPropagation();
      }, { capture: true });
    }

    if (footer) footer.hidden = true;

    if (reopen) {
      reopen.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 再表示（今回は単純表示。remove後は location.reload() 等で復元）
        const ov = $id('cookie-overlay');
        if (ov) {
          ov.hidden = false;
          ov.style.display = 'block';
          ensureOverlayInteractive(ov);
        } else {
          // 既に remove 済みなら再読み込みで出す簡易実装
          location.reload();
        }
      });
    }
  });
})();
