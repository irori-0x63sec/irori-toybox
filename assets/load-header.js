// /assets/load-header.js
(async function mountHeader(){
  const hostHeader = document.getElementById('site-header');
  if (!hostHeader) return;

  // 取り込み（キャッシュ無効化で反映ズレ防止）
  try {
    const res = await fetch('/partials/header.html', { cache: 'no-cache' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const html = await res.text();
    hostHeader.innerHTML = html;
    hostHeader.hidden = false;
  } catch (e) {
    console.warn('[header] load failed:', e);
    hostHeader.hidden = false;
    hostHeader.innerHTML = `
      <div class="nav">
        <a class="brand" href="/"><div class="logo">IT</div><strong>Irori's Toybox</strong></a>
        <nav><a class="link" href="/">Home</a></nav>
      </div>`;
    return;
  }

  // 現在ページをアクティブ表示（/changelog/xxx でも「更新履歴」をハイライト）
  try {
    const path = location.pathname.endsWith('/') ? location.pathname : (location.pathname + '/');
    const links = Array.from(document.querySelectorAll('header.site .link'));
    let current = null, maxLen = -1;
    for (const a of links) {
      const p = a.getAttribute('data-path');
      if (p && path.startsWith(p) && p.length > maxLen) { current = a; maxLen = p.length; }
    }
    if (current) current.setAttribute('aria-current', 'page');
  } catch {}
})();
