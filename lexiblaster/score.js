// グローバルに window.ScoreTracker / window.ScoreboardOverlay を定義
(function () {
  // -------------------------------
  // ScoreTracker: スコア内訳の記録・集計
  // -------------------------------
  class ScoreTracker {
    constructor() { this.reset(); }
    reset() { this.events = []; }

    /**
     * @param {'CORRECT'|'MISTAKE'|'SPEED_BONUS'|'TIME_BONUS'|'LIFE_LOST'|'OTHER'} type
     * @param {number} delta
     * @param {object} meta 任意: {word,en,ja,expect,got,hint,avgWPM,...}
     */
    record(type, delta, meta = {}) {
      this.events.push({ type, delta, meta, t: performance.now() });
    }

    total() { return this.events.reduce((a, e) => a + (e.delta || 0), 0); }

    grouped() {
      const m = new Map();
      for (const e of this.events) {
        if (!m.has(e.type)) m.set(e.type, { type: e.type, sum: 0, count: 0 });
        const g = m.get(e.type);
        g.sum += (e.delta || 0);
        g.count += 1;
      }
      return [...m.values()].sort((a, b) => Math.abs(b.sum) - Math.abs(a.sum));
    }

    stats() {
      const correct = this.events.filter(e => e.type === 'CORRECT').length;
      const mistakes = this.events.filter(e => e.type === 'MISTAKE').length;
      const attempts = correct + mistakes;
      const accuracy = attempts ? correct / attempts : 0;
      return { correct, mistakes, attempts, accuracy };
    }

    /** 共有用の1行テキスト（スコア/モード/連続正解などを含む） */
    toTweetText({
      gameName = 'LexiBlaster',
      finalScore = 0,
      levelName,
      modeLabel,
      mode,
      streak = {},
      personalBest = false,
      highestScore,
    } = {}) {
      const score = Math.max(0, Math.round(Number(finalScore) || 0));
      const modeText = (modeLabel || this._modeLabel(mode) || '').trim();
      const streakCurrent = Math.max(0, Math.round(Number(streak.current) || 0));
      const streakBest = Math.max(0, Math.round(Number(streak.best) || 0));

      const headline = personalBest
        ? `${gameName} 自己ベスト更新！`
        : `${gameName} をプレイ`;

      const segments = [headline];
      segments.push(`スコア ${score} pts`);
      if (levelName) segments.push(`Lv ${levelName}`);
      if (modeText) segments.push(`モード ${modeText}`);

      let streakSegment = `連続正解 ${streakCurrent}`;
      if (streakBest > 0 && streakBest > streakCurrent) {
        streakSegment += ` (Max ${streakBest})`;
      }
      segments.push(streakSegment);

      if (personalBest && highestScore && highestScore !== score) {
        segments.push(`自己ベスト ${highestScore} pts`);
      }

      segments.push('#LexiBlaster');

      return segments.filter(Boolean).join(' | ');
    }

    _modeLabel(modeKey) {
      switch (modeKey) {
        case 'en_jp': return 'EN→JP';
        case 'jp_en': return 'JP→EN';
        case 'en_en': return 'EN→EN';
        default: return modeKey || '';
      }
    }

    label(type) {
      switch (type) {
        case 'CORRECT': return '正解';
        case 'MISTAKE': return 'ミス';
        case 'SPEED_BONUS': return '速度ボーナス';
        case 'TIME_BONUS': return 'タイムボーナス';
        case 'LIFE_LOST': return 'ライフ喪失';
        default: return 'その他';
      }
    }

    /** 復習用ミス一覧（EN/日本語対応） */
    mistakesList({ unique = true } = {}) {
      const list = this.events
        .filter(e => e.type === 'MISTAKE')
        .map(e => ({
          hint:   e.meta?.hint   || '',
          expect: e.meta?.expect || '',
          en:     e.meta?.en     || '',
          ja:     e.meta?.ja     || '',
          got:    e.meta?.got    || '',
          t:      e.t
        }));
      if (!unique) return list;
      const seen = new Set(), out = [];
      for (const m of list) {
        const k = (m.expect || m.en || '').toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(m);
      }
      return out;
    }
  }

  // -------------------------------
  // ScoreboardOverlay: 終了時のスコア画面（内訳＋X共有＋ミス一覧）
  // -------------------------------
  class ScoreboardOverlay {
    constructor(root = document.body) {
      this.root = root;
      this.el = null;
      this.onRestart = null;
      this._ensureStyle();
      this._ensureDom();
    }

    _ensureStyle() {
      if (document.getElementById('lexi-scoreboard-style')) return;
      const css = `
      .lexi-sb-backdrop{position:fixed;inset:0;backdrop-filter:blur(6px);background:rgba(4,10,20,.55);display:grid;place-items:center;z-index:9999;}
      .lexi-sb-card{width:min(720px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:rgba(14,18,28,.9);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;color:#eaf6ff;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);}
      .lexi-sb-title{font-size:24px;font-weight:800;margin:0 0 8px;display:flex;align-items:center;gap:8px;}
      .lexi-sb-sub{font-size:13px;opacity:.8;margin:0 0 16px;}
      .lexi-sb-total{display:flex;align-items:baseline;gap:8px;margin:8px 0 16px;}
      .lexi-sb-total b{font-size:40px;letter-spacing:.5px;}
      .lexi-sb-kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
      .lexi-chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:8px 10px;border-radius:999px;font-size:12px;}
      .lexi-badge{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:999px;background:linear-gradient(135deg,#ffe17d,#f9a825);color:#1a1c24;font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;box-shadow:0 2px 6px rgba(0,0,0,.3);}
      #lb-badge-pb{margin-left:4px;}
      table.lexi-sb-table{width:100%;border-collapse:collapse;margin:6px 0 16px;}
      table.lexi-sb-table th,table.lexi-sb-table td{border-bottom:1px dashed rgba(255,255,255,.08);padding:8px 6px;font-size:13px;text-align:left;}
      table.lexi-sb-table th:nth-child(2),table.lexi-sb-table td:nth-child(2){text-align:right;white-space:nowrap;}
      .lexi-sb-actions{display:flex;gap:10px;flex-wrap:wrap;}
      .lexi-btn{appearance:none;border:none;padding:10px 14px;border-radius:10px;background:#1d9bf0;color:#fff;font-weight:700;cursor:pointer;}
      .lexi-btn.secondary{background:rgba(255,255,255,.10);color:#eaf6ff;}
      .lexi-note{font-size:12px;opacity:.75;margin-top:8px;}

      .lexi-miss{margin-top:12px;background:rgba(255,255,255,.05);padding:10px;border-radius:12px;max-height:180px;overflow:auto;}
      .lexi-miss h3{font-size:14px;margin:0 0 6px 0;opacity:.85;}
      .lexi-miss ul{margin:0;padding-left:18px;}
      .lexi-miss li{font-size:14px;line-height:1.6;margin:4px 0;}
      .lexi-miss code{font-weight:700;}

      .lexi-leaderboard{margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,.06);}
      .lexi-leaderboard h3{margin:0 0 8px;font-size:16px;}
      .lexi-leaderboard label{display:block;font-size:12px;font-weight:600;margin-bottom:6px;letter-spacing:.2px;}
      .lexi-leaderboard-form{margin-bottom:14px;}
      .lexi-leaderboard-inputs{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}
      .lexi-leaderboard-inputs input{flex:1 1 200px;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.18);color:#fff;border-radius:8px;padding:8px 10px;font-size:14px;min-width:160px;}
      .lexi-leaderboard-inputs input:focus{outline:none;border-color:#1d9bf0;box-shadow:0 0 0 2px rgba(29,155,240,.35);}
      .lexi-leaderboard .lexi-btn{font-size:13px;padding:8px 12px;}
      .lexi-leaderboard .lexi-btn.tertiary{background:#4f6df5;}
      .lexi-leaderboard .lexi-btn.tertiary:disabled{opacity:.5;cursor:not-allowed;}
      .lb-status{font-size:13px;margin:6px 0 12px 0;}
      .lb-status--info{color:#bcd9ff;}
      .lb-status--loading{color:#9ad0ff;}
      .lb-status--success{color:#8ef59d;}
      .lb-status--error{color:#ff8e8e;}
      .lb-status--warning{color:#ffd27d;}
      .lb-layout{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start;}
      .lb-primary{flex:1 1 320px;min-width:260px;}
      .lb-vertical{flex:1 1 220px;min-width:200px;padding:12px;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(255,255,255,.03);}
      .lb-vertical-heading{margin:0 0 6px;font-size:14px;font-weight:700;letter-spacing:.3px;color:#bcd9ff;}
      .lb-vertical .lb-status{margin:0 0 8px 0;}
      .lb-list{list-style:none;padding:0;margin:0;}
      .lb-list li{display:flex;align-items:baseline;gap:8px;padding:6px 0;border-top:1px solid rgba(255,255,255,.08);font-size:13px;}
      .lb-list li:first-child{border-top:none;}
      .lb-list li .lb-rank{min-width:3.2em;}
      .lb-rank{font-weight:700;margin-right:8px;}
      .lb-name{margin-right:8px;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
      .lb-score{color:#9ab6c9;}
      .lb-table th:nth-child(3),.lb-table td:nth-child(3){text-align:right;}
      .lb-table td:nth-child(2){max-width:220px;overflow:hidden;text-overflow:ellipsis;}
      .lb-table tr.lb-row-self td{background:rgba(92,212,255,.10);}
      .lb-list li.lb-row-self{background:rgba(92,212,255,.10);border-radius:6px;padding:6px 10px;}
      .lb-row-self{background:rgba(92,212,255,.10);border-radius:6px;}
      `;
      const st = document.createElement('style');
      st.id = 'lexi-scoreboard-style';
      st.textContent = css;
      document.head.appendChild(st);
    }

    _ensureDom() {
      if (this.el) return;
      const wrap = document.createElement('div');
      wrap.className = 'lexi-sb-backdrop';
      wrap.style.display = 'none';
      wrap.innerHTML = `
        <div class="lexi-sb-card" role="dialog" aria-modal="true" aria-label="Score">
          <h2 class="lexi-sb-title">Game Over <span class="lexi-badge" id="lb-badge-pb" hidden>PB</span></h2>
          <p class="lexi-sb-sub" id="lexi-meta"></p>

          <div class="lexi-sb-total">
            <span>Total</span><b id="lexi-total">0</b><span>pts</span>
          </div>

          <div class="lexi-sb-kpis" id="lexi-kpis"></div>

          <table class="lexi-sb-table" id="lexi-table">
            <thead><tr><th>内訳</th><th>点</th></tr></thead>
            <tbody></tbody>
          </table>

          <div class="lexi-miss" id="lexi-miss" style="display:none">
            <h3>ミスした単語</h3>
            <ul id="lexi-miss-list"></ul>
            <p class="lexi-note">※このリストは共有テキストには含まれません。</p>
          </div>

          <div class="lexi-leaderboard" id="lb-leaderboard" hidden>
            <h3>オンラインランキング</h3>
            <div class="lb-layout">
              <div class="lb-primary">
                <p class="lb-status" id="lb-leaderboard-status" aria-live="polite">ハイスコアを登録してランキングに参加しよう！</p>
                <form class="lexi-leaderboard-form" id="lb-leaderboard-form">
                  <label for="lb-leaderboard-name">ハンドルネーム（1〜12文字）</label>
                  <div class="lexi-leaderboard-inputs">
                    <input type="text" id="lb-leaderboard-name" name="name" maxlength="12" autocomplete="nickname" required />
                    <button type="submit" class="lexi-btn tertiary" id="lb-leaderboard-submit">スコア登録</button>
                  </div>
                </form>
                <table class="lexi-sb-table lb-table" id="lb-leaderboard-table">
                  <thead><tr><th>Rank</th><th>Name</th><th>Score</th></tr></thead>
                  <tbody id="lb-leaderboard-body"></tbody>
                </table>
                <p class="lexi-note" id="lb-leaderboard-empty" hidden>まだ登録がありません。最初の挑戦者になろう！</p>
              </div>
              <aside id="lb-vertical" class="lb-vertical" hidden>
                <p class="lb-vertical-heading">TOP 20</p>
                <div id="lb-vertical-status" class="lb-status" hidden></div>
                <ol id="lb-vertical-list" class="lb-list"></ol>
              </aside>
            </div>
          </div>

          <div class="lexi-sb-actions">
            <button class="lexi-btn" id="lexi-share">X で共有</button>
            <button class="lexi-btn secondary" id="lexi-restart">もう一度</button>
          </div>

          <div class="lexi-note">※ スコアは今後調整される場合があります。</div>
        </div>
      `;
      this.root.appendChild(wrap);
      this.el = wrap;

      wrap.querySelector('#lexi-restart').addEventListener('click', () => {
        this.hide();
        this.onRestart?.();
      });
      wrap.querySelector('#lexi-share').addEventListener('click', () => {
        this._share().catch(err => console.error('[ScoreboardOverlay] share failed', err));
      });
    }

    /**
     * @param {{tracker:ScoreTracker, meta:any, url?:string}} param0
     */
    show({ tracker, meta = {}, url = location.href }) {
      this.tracker = tracker;
      this.meta = meta;
      this.url = url;

      const total = Math.max(0, tracker.total());
      const groups = tracker.grouped();
      const { accuracy, correct, mistakes } = tracker.stats();

      // メタ/合計
      const pbBadge = this.el.querySelector('#lb-badge-pb');
      if (pbBadge) pbBadge.hidden = !meta.personalBest;

      const metaEl = this.el.querySelector('#lexi-meta');
      const avgWpm = Math.round(Number(meta.avgWPM) || 0);
      const playTime = Math.round(Number(meta.playTimeSec) || 0);
      const highestScore = Math.round(Number(meta.highestScore) || 0);
      const modeLabel = (meta.modeLabel || meta.mode || '').trim();
      const metaParts = [
        `Lv:${meta.levelName ?? 'N/A'}`,
        modeLabel ? `Mode:${modeLabel}` : null,
        `AvgWPM:${avgWpm}`,
        `Time:${playTime}s`
      ];
      if (highestScore > 0) metaParts.push(`PB:${highestScore}pts`);
      metaEl.textContent = metaParts.filter(Boolean).join(' / ');
      this.el.querySelector('#lexi-total').textContent = total;

      // KPIチップ
      const k = this.el.querySelector('#lexi-kpis');
      k.innerHTML = '';
      k.append(this._chip(`正解 ${correct}`));
      k.append(this._chip(`ミス ${mistakes}`));
      k.append(this._chip(`精度 ${(accuracy * 100).toFixed(1)}%`));
      if (meta?.streak) {
        const bestStreak = Math.max(0, Math.round(Number(meta.streak.best ?? meta.streak.current) || 0));
        k.append(this._chip(`連続正解 ${bestStreak}`));
      }

      // 内訳テーブル
      const tbody = this.el.querySelector('#lexi-table tbody');
      tbody.innerHTML = '';
      for (const g of groups) {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${this._label(g.type)}</td><td>${g.sum > 0 ? '+' : ''}${g.sum}</td>`;
        tbody.appendChild(tr);
      }

      // ミス一覧（EN/日本語ペア。Shareには含めない）
      const missWrap = this.el.querySelector('#lexi-miss');
      const missUl = this.el.querySelector('#lexi-miss-list');
      missUl.innerHTML = '';
      const misses = tracker.mistakesList({ unique: true });
      if (misses.length === 0) {
        missWrap.style.display = 'none';
      } else {
        missWrap.style.display = '';
        for (const m of misses) {
          const en = (m.en || m.expect || '').trim();
          const ja = (m.ja || '').trim();
          const li = document.createElement('li');
          li.innerHTML = `<code>${en || '-'}</code> / <span>${ja || '-'}</span>`;
          missUl.appendChild(li);
        }
      }

      this.el.style.display = 'grid';

      const leaderboardRoot = this.el.querySelector('#lb-leaderboard');
      this._dispatchLeaderboard('show', { tracker, meta, total, root: leaderboardRoot, limit: 20 });
    }

    hide() {
      this.el.style.display = 'none';
      const leaderboardRoot = this.el?.querySelector('#lb-leaderboard');
      this._dispatchLeaderboard('hide', { root: leaderboardRoot });
    }

    _chip(text) {
      const s = document.createElement('span');
      s.className = 'lexi-chip';
      s.textContent = text;
      return s;
    }

    _label(t) { return (new ScoreTracker()).label(t); }

    async _share() {
      const meta = this.meta || {};
      const fallbackScore = Math.max(0, Math.round(this.tracker.total()));
      const text = this.tracker.toTweetText({
        gameName: meta.gameName || 'LexiBlaster',
        finalScore: meta.finalScore ?? fallbackScore,
        levelName: meta.levelName,
        modeLabel: meta.modeLabel,
        mode: meta.mode,
        streak: meta.streak,
        personalBest: !!meta.personalBest,
        highestScore: meta.highestScore
      });

      const shareUrl = this._buildShareUrl();
      const shareText = shareUrl ? `${text} ${shareUrl}` : text;

      if (navigator.share) {
        try {
          await navigator.share({ text, url: shareUrl || undefined });
          return;
        } catch (err) {
          if (err && err.name === 'AbortError') return;
          console.warn('[ScoreboardOverlay] navigator.share failed', err);
        }
      }

      if (this._openXIntent(text, shareUrl)) return;

      await this._copyToClipboard(shareText);
    }

    _buildShareUrl() {
      if (!this.url) return '';
      try {
        const u = new URL(this.url, location.origin);
        const allowAnalytics = !!window.lexiConsent?.allow?.('analytics');
        const utmKeys = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content'];
        if (allowAnalytics) {
          u.searchParams.set('utm_source', 'lexiblaster');
          u.searchParams.set('utm_medium', 'share');
          u.searchParams.set('utm_campaign', 'scoreboard');
          u.searchParams.set('utm_content', 'overlay');
        } else {
          for (const key of utmKeys) u.searchParams.delete(key);
        }
        return u.toString();
      } catch (err) {
        console.warn('[ScoreboardOverlay] invalid share URL', err);
        return this.url;
      }
    }

    _openXIntent(text, url) {
      try {
        const params = new URLSearchParams();
        params.set('text', text);
        if (url) params.set('url', url);
        const xUrl  = 'https://x.com/intent/post?' + params.toString();
        const twUrl = 'https://twitter.com/intent/tweet?' + params.toString();
        const w = window.open(xUrl, '_blank', 'noopener,noreferrer');
        if (w) return true;
        const fallback = window.open(twUrl, '_blank', 'noopener,noreferrer');
        return !!fallback;
      } catch (err) {
        console.error('[ScoreboardOverlay] failed to open share intent', err);
        return false;
      }
    }

    async _copyToClipboard(text) {
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          alert('共有テキストをコピーしました！');
          return;
        } catch (err) {
          console.error('[ScoreboardOverlay] clipboard write failed', err);
        }
      }
      this._promptCopy(text);
    }

    _promptCopy(text) {
      try {
        window.prompt('共有に失敗しました。以下のテキストをコピーしてください。', text);
      } catch (err) {
        console.error('[ScoreboardOverlay] prompt copy failed', err);
      }
    }

    _dispatchLeaderboard(type, detail = {}) {
      try {
        const ev = new CustomEvent(`lb:leaderboard:${type}`, { detail });
        window.dispatchEvent(ev);
      } catch (err) {
        console.warn('[ScoreboardOverlay] leaderboard event error', err);
      }
    }
  }

  // export
  window.ScoreTracker = ScoreTracker;
  window.ScoreboardOverlay = ScoreboardOverlay;
})();
