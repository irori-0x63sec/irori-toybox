// consent.js（差し替え）
(function () {
  const KEY = 'lexiConsent.v1';
  const SCRIPTS = ['canvas.js', 'score.js', 'main.js'];

  const $ = (id) => document.getElementById(id);

  function show(el) { if (el) el.hidden = false; }
  function hide(el) { if (el) el.hidden = true; }
  function rm(el)   { if (el && el.parentNode) el.parentNode.removeChild(el); }

  function loadGameScripts() {
    // すでに読込済みなら二重ロードしない
    if (document.querySelector('script[data-lexi-game="1"]')) return;
    for (const src of SCRIPTS) {
      const s = document.createElement('script');
      s.src = src;
      s.defer = true;
      s.dataset.lexiGame = '1';
      document.body.appendChild(s);
    }
  }

  function applyChoice(choice) {
    // 保存
    try {
      localStorage.setItem(KEY, JSON.stringify({ choice, at: Date.now() }));
    } catch (_) {}

    // 閉じる（確実に）
    rm($('cookie-overlay'));

    // フッターの「Cookie設定」リンクは表示しておく
    show($('cookie-footer-link'));

    // ゲーム読み込み
    loadGameScripts();
  }

  function reopenDialog() {
    // まだDOMに残っていなければ作り直し（今回は最初のHTMLを使う前提）
    const overlay = $('cookie-overlay');
    if (!overlay) return; // 既に削除した後は何もしない（再表示は別UIで実装想定）
    show(overlay);
  }

  // 初期化
  window.addEventListener('DOMContentLoaded', () => {
    const overlay = $('cookie-overlay');
    const btnAll  = $('cookie-accept-all');
    const btnEss  = $('cookie-accept-essential');
    const btnRej  = $('cookie-reject-all');
    const footer  = $('cookie-footer-link');
    const openBtn = $('cookie-open-settings');

    // ID が正しく取得できているかのデバッグ
    // console.log({
    //   overlay: !!overlay, btnAll: !!btnAll, btnEss: !!btnEss, btnRej: !!btnRej, footer: !!footer, openBtn: !!openBtn
    // });

    // 既に選択済みならオーバーレイ出さずにゲーム読み込み
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) {}
    if (saved && saved.choice) {
      // 設定済み → オーバーレイは消してゲームだけ読む
      rm(overlay);
      show(footer);          // 設定リンクは出しておく
      loadGameScripts();
      return;
    }

    // 未選択 → オーバーレイを表示し、選ぶまでゲームは読み込まない
    show(overlay);
    hide(footer);

    // クリックで確実に閉じ＆保存＆ゲーム読み込み
    if (btnAll) btnAll.addEventListener('click', () => applyChoice('all'));
    if (btnEss) btnEss.addEventListener('click', () => applyChoice('essential'));
    if (btnRej) btnRej.addEventListener('click', () => applyChoice('reject'));

    // 再表示用リンク
    if (openBtn) openBtn.addEventListener('click', () => {
      // いったん簡易実装：ページを再読込して再表示（最小実装で確実）
      // location.reload();
      // （ダイアログをDOMから消している場合は上のreloadでOK。
      //  残している場合は単純に表示でよい）
      const ov = $('cookie-overlay');
      if (ov) show(ov);
    });
  });
})();
