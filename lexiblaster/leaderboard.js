// leaderboard.js

(function() {
  const apiBase = window.LEXI_LEADERBOARD_BASE || 'https://lb.irori-toybox.com';

  async function fetchLeaderboard(limit, context) {
    const url = new URL(`${apiBase}/top`);
    url.searchParams.set('limit', limit);
    if (context.mode) url.searchParams.set('mode', context.mode);
    if (context.level) url.searchParams.set('level', context.level);

    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error(`Failed to fetch leaderboard: ${res.status}`);
    const json = await res.json();
    return json.items || [];
  }

  async function submitScore({ name, score, mode, level }) {
    if (!name || !name.trim()) {
      throw new Error('NAME_REQUIRED');
    }
    const res = await fetch(`${apiBase}/score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim(), score, mode, level })
    });
    if (!res.ok) throw new Error(`Submit failed: ${res.status}`);
    return await res.json();
  }

  function renderLeaderboard(container, entries) {
    container.innerHTML = '';
    if (!entries.length) {
      container.innerHTML = '<li>まだスコアがありません。</li>';
      return;
    }
    for (const e of entries) {
      const li = document.createElement('li');
      li.textContent = `${e.rank}位 ${e.name} ${e.score}pt (${e.level} / ${e.mode})`;
      container.appendChild(li);
    }
  }

  function init() {
    const form = document.getElementById('lb-form');
    const listEl = document.getElementById('lb-list');
    const statusEl = document.getElementById('lb-status');

    async function load() {
      try {
        statusEl.textContent = 'ランキングを読み込み中…';
        const items = await fetchLeaderboard(20, { mode: 'en_en', level: 'A1' });
        renderLeaderboard(listEl, items);
        statusEl.textContent = '';
      } catch (err) {
        console.error('[Leaderboard] fetch failed', err);
        statusEl.textContent = 'ランキングを取得できませんでした。';
      }
    }

    async function handleSubmit(e) {
      e.preventDefault();
      const nameInput = document.getElementById('lb-leaderboard-name');
      const name = (nameInput?.value || '').trim();
      if (!name) {
        console.warn('[Leaderboard] name is required');
        statusEl.textContent = 'ハンドルネームを入力してください。';
        return;
      }
      const score = Number(document.getElementById('lb-score').value) || 0;
      const mode = document.getElementById('lb-mode').value || 'en_en';
      const level = document.getElementById('lb-level').value || 'A1';

      try {
        const result = await submitScore({ name, score, mode, level });
        console.log('[Leaderboard] submit ok', result);
        statusEl.textContent = `登録しました！（順位: ${result.rank}位）`;
        load();
      } catch (err) {
        console.error('[Leaderboard] submit failed', err);
        statusEl.textContent = '登録に失敗しました。';
      }
    }

    if (form) form.addEventListener('submit', handleSubmit);
    load();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
