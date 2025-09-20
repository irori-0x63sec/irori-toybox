// すべて自己完結：CSSとバナーHTMLを動的に注入し、localStorageに同意状態を保存。
// API:
//   window.hasConsent(category)             // 'necessary' | 'analytics' | 'ads'
//   window.runIfConsented(category, fn)     // 同意がある時だけfnを実行

(function () {
  const KEY = 'consent.v1';
  const DEFAULT = { necessary: true, analytics: false, ads: false, ts: 0 };

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULT };
      const v = JSON.parse(raw);
      return { ...DEFAULT, ...v };
    } catch {
      return { ...DEFAULT };
    }
  }
  function save(obj) {
    localStorage.setItem(KEY, JSON.stringify({ ...obj, ts: Date.now() }));
  }

  // --- CSS を <head> に注入（既存CSSは触らない） ---
  const css = `
  .cc-wrap{position:fixed;left:0;right:0;bottom:0;z-index:99999;display:none;padding:14px 16px;background:rgba(10,15,22,.96);border-top:1px solid rgba(255,255,255,.08);box-shadow:0 -8px 28px rgba(0,0,0,.35)}
  .cc-inner{max-width:980px;margin:0 auto;display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center}
  .cc-text{font:14px/1.6 system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#eaf6ff;opacity:.95}
  .cc-text a{color:#9ad5ff;text-decoration:underline}
  .cc-actions{display:flex;gap:8px;flex-wrap:wrap}
  .cc-btn{appearance:none;border:none;cursor:pointer;padding:10px 14px;border-radius:10px;font-weight:700;font-size:14px}
  .cc-accept{background:#1d9bf0;color:#fff}
  .cc-reject{background:rgba(255,255,255,.10);color:#eaf6ff}
  `;
  const styleEl = document.createElement('style');
  styleEl.setAttribute('data-consent-style', 'v1');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // --- バナーDOMをボディ末尾に挿入 ---
  function ensureBanner() {
    if (document.getElementById('cc-wrap')) return;

    const wrap = document.createElement('div');
    wrap.className = 'cc-wrap';
    wrap.id = 'cc-wrap';
    wrap.innerHTML = `
      <div class="cc-inner">
        <div class="cc-text">
          本サイトでは、機能向上や計測・広告のためにクッキー等を利用する場合があります。
          詳細は <a href="/privacy" target="_blank" rel="noopener">プライバシーポリシー</a> をご確認ください。
        </div>
        <div class="cc-actions">
          <button class="cc-btn cc-reject" id="cc-reject">拒否（必須のみ）</button>
          <button class="cc-btn cc-accept" id="cc-accept">同意する（すべて）</button>
        </div>
      </div>
    `;
    document.body.appendChild(wrap);

    document.getElementById('cc-accept').addEventListener('click', () => {
      const c = load();
      c.analytics = true;
      c.ads = true;
      save(c);
      hideBanner();
      document.dispatchEvent(new CustomEvent('consent:updated', { detail: c }));
    });

    document.getElementById('cc-reject').addEventListener('click', () => {
      const c = load();
      c.analytics = false;
      c.ads = false;
      save(c);
      hideBanner();
      document.dispatchEvent(new CustomEvent('consent:updated', { detail: c }));
    });
  }

  function showBanner() {
    const el = document.getElementById('cc-wrap');
    if (el) el.style.display = 'block';
  }
  function hideBanner() {
    const el = document.getElementById('cc-wrap');
    if (el) el.style.display = 'none';
  }

  // 公開API
  window.hasConsent = function (category) {
    const c = load();
    if (category === 'necessary') return true;
    return !!c[category];
  };
  window.runIfConsented = function (category, fn) {
    if (window.hasConsent(category)) {
      try { fn(); } catch (e) { console.error(e); }
      return true;
    }
    return false;
  };

  document.addEventListener('DOMContentLoaded', () => {
    ensureBanner();
    const c = load();
    if (c.ts === 0) showBanner(); // 未選択なら表示
  });
})();
