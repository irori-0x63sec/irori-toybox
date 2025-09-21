// ads-loader.js — “ALL 同意のみ”で手動広告枠をロード（AdSense例）

(function(){
  // ====== 設定（あなたのIDに変更）=========================
  const ADS_CLIENT = 'ca-pub-0000000000000000'; // ←あなたの AdSense client
  const SLOT_LEFT  = '1111111111';             // ←左枠の data-ad-slot
  const SLOT_RIGHT = '2222222222';             // ←右枠の data-ad-slot
  // =========================================================

  let adsScriptAdded = false;
  let adsRendered    = false;

  function $(sel){ return document.querySelector(sel); }

  // AdSenseスクリプトを動的挿入（同意後のみ）
  function addAdSenseScript(){
    if (adsScriptAdded) return Promise.resolve();
    return new Promise((resolve, reject)=>{
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(ADS_CLIENT)}`;
      s.setAttribute('crossorigin','anonymous');
      s.onload  = ()=>{ adsScriptAdded = true; resolve(); };
      s.onerror = ()=> reject(new Error('Failed to load AdSense'));
      document.head.appendChild(s);
    });
  }

  // 既存の .ad-slot に <ins class="adsbygoogle"> を差し込んで表示
  function renderManualSlots(){
    if (adsRendered) return;
    const leftEl  = $('#ad-left');
    const rightEl = $('#ad-right');

    // 同意中に出していたプレースホルダを消す
    [leftEl, rightEl].forEach(el=>{
      if (!el) return;
      const ph = el.querySelector('.ad-ph');
      if (ph) ph.remove();
    });

    // それぞれの枠に ins を構築
    function mountIns(parent, slotId){
      if (!parent) return;
      // 二重差し込み防止
      if (parent.querySelector('ins.adsbygoogle')) return;
      const ins = document.createElement('ins');
      ins.className = 'adsbygoogle';
      ins.style.display = 'block';
      // 幅はCSSで枠を2分割にしているので、レスポンシブ表示でOK
      ins.setAttribute('data-ad-client', ADS_CLIENT);
      ins.setAttribute('data-ad-slot', slotId);
      ins.setAttribute('data-ad-format', 'auto');
      ins.setAttribute('data-full-width-responsive', 'true');
      parent.appendChild(ins);
      try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch(e){ /* noop */ }
    }

    mountIns(leftEl,  SLOT_LEFT);
    mountIns(rightEl, SLOT_RIGHT);

    adsRendered = true;
  }

  async function enableAdsIfConsented(){
    // 同意APIがなければ何もしない（保守的にNO扱い）
    const allow = (window.lexiConsent && window.lexiConsent.allow)
      ? window.lexiConsent.allow('ads')
      : false;
    if (!allow) return;

    try {
      await addAdSenseScript();
      renderManualSlots();
    } catch (e) {
      console.warn('[ads] load failed:', e);
    }
  }

  // 同意変更イベントで反応（ALLに切り替わったらロード）
  document.addEventListener('lb:consent', (e)=>{
    const choice = e?.detail?.choice;
    if (choice === 'all') enableAdsIfConsented();
    // 拒否に戻したら、見た目を空に（ネットワークは以降発生しない）
    if (choice === 'reject' || choice === 'essential'){
      document.querySelectorAll('#ad-left, #ad-right').forEach(el => {
        // 既に表示中のad要素をクリア
        el.querySelectorAll('ins.adsbygoogle, iframe, script').forEach(n=> n.remove());
        // プレースホルダ復活（任意）
        if (!el.querySelector('.ad-ph')) {
          const span = document.createElement('span');
          span.className = 'ad-ph';
          span.textContent = 'AD 300×250 / 320×50 / 728×90 など';
          el.appendChild(span);
        }
      });
      adsRendered = false;
    }
  });

  // 初期同意が "all" だったときの即時ロード
  function boot(){
    // 既に ALL ならロード
    try {
      if (window.lexiConsent && window.lexiConsent.allow('ads')) {
        enableAdsIfConsented();
      }
    } catch(_) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
