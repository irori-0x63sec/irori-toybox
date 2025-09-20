// consent.js
// 目的：Cookie同意をゲーム読み込み前に必須化し、選択に応じてスクリプトを動的読み込み。
// 結果は localStorage "cookieConsent" に保存（{ level: 'all' | 'essential' | 'reject', ts }）。

(function () {
  const OVERLAY_ID = 'cookie-overlay';
  const FOOTER_LINK_ID = 'cookie-footer-link';

  const state = {
    loaded: false,
  };

  function $(id) { return document.getElementById(id); }

  function showOverlay() {
    const el = $(OVERLAY_ID);
    if (!el) return;
    el.hidden = false;
  }

  function hideOverlay() {
    const el = $(OVERLAY_ID);
    if (!el) return;
    el.hidden = true;
  }

  function showFooterLink() {
    const el = $(FOOTER_LINK_ID);
    if (!el) return;
    el.hidden = false;
  }

  function saveConsent(level) {
    const data = { level, ts: Date.now() };
    localStorage.setItem('cookieConsent', JSON.stringify(data));
    // 外部から参照できるように
    window.cookieConsent = data;
  }

  function readConsent() {
    try {
      const raw = localStorage.getItem('cookieConsent');
      if (!raw) return null;
      const data = JSON.parse(raw);
      window.cookieConsent = data;
      return data;
    } catch { return null; }
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.body.appendChild(s);
    });
  }

  async function loadGame() {
    if (state.loaded) return;
    state.loaded = true;

    // ゲーム本体スクリプト群
    await loadScript('canvas.js');
    await loadScript('score.js');  // ← LINE共有ボタンもここで扱う
    await loadScript('main.js');

    // もし「すべて同意」のときだけ広告/計測スクリプトを読み込みたいなら、ここで条件分岐
    const consent = readConsent();
    if (consent && consent.level === 'all') {
      // 例: Google Analytics / AdSense など
      // await loadScript('ads.js');
      // await loadScript('analytics.js');
    }

    // フッタの「Cookie設定」を表示（再設定用）
    showFooterLink();
  }

  function openSettings() {
    // 設定の再表示（オーバーレイ復活）
    const overlay = $(OVERLAY_ID);
    if (overlay) {
      overlay.hidden = false;
      overlay.querySelector('.cookie-card')?.focus();
    }
  }

  function attachEvents() {
    const btnAll = $('cookie-accept-all');
    const btnEssential = $('cookie-accept-essential');
    const btnReject = $('cookie-reject-all');
    const btnOpenSettings = $('cookie-open-settings');

    if (btnAll) {
      btnAll.addEventListener('click', async () => {
        saveConsent('all');
        hideOverlay();
        await loadGame();
      });
    }
    if (btnEssential) {
      btnEssential.addEventListener('click', async () => {
        saveConsent('essential');
        hideOverlay();
        await loadGame();
      });
    }
    if (btnReject) {
      btnReject.addEventListener('click', async () => {
        saveConsent('reject');
        hideOverlay();
        await loadGame();
      });
    }
    if (btnOpenSettings) {
      btnOpenSettings.addEventListener('click', () => {
        openSettings();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    attachEvents();
    const consent = readConsent();
    if (consent) {
      // 既に選択済みなら即ロード
      await loadGame();
      showFooterLink();
    } else {
      // まだならオーバーレイを出して選択させる
      showOverlay();
    }
  });
})();
