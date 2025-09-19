// === score.js ===
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

    /** X共有用テキスト（MISTAKEは含めない） */
    toTweetText({ gameName = 'LexiBlaster', level = 'N/A', avgWPM = 0 } = {}) {
      const total = Math.max(0, this.total());
      const { accuracy, correct, mistakes } = this.stats();
      const accPct = (accuracy * 100).toFixed(1);
      const top = this.grouped()
        .filter(g => g.type !== 'MISTAKE' && g.sum > 0)
        .slice(0, 3)
        .map(g => `${this.label(g.type)}+${g.sum}`)
        .join(' / ');
      const pieces = [
        `${gameName} でスコア ${total}`,
        `Lv:${level}`,
        `Accuracy:${accPct}% (${correct}-${mistakes})`,
        top ? `Bonus:${top}` : '',
        `AvgWPM:${Math.round(avgWPM)}`
      ].filter(Boolean);
      return pieces.join(' | ') + `\n#LexiBlaster #英単語ゲーム`;
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
      .lexi-sb-title{font-size:24px;font-weight:800;margin:0 0 8px;}
      .lexi-sb-sub{font-size:13px;opacity:.8;margin:0 0 16px;}
      .lexi-sb-total{display:flex;align-items:baseline;gap:8px;margin:8px 0 16px;}
      .lexi-sb-total b{font-size:40px;letter-spacing:.5px;}
      .lexi-sb-kpis{display:flex;gap:12px;flex-wrap:wrap;margin-bottom:14px;}
      .lexi-chip{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.08);padding:8px 10px;border-radius:999px;font-size:12px;}
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
          <h2 class="lexi-sb-title">Game Over</h2>
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
      wrap.querySelector('#lexi-share').addEventListener('click', () => this._share());
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
      this.el.querySelector('#lexi-meta').textContent =
        `Lv:${meta.levelName ?? 'N/A'} / AvgWPM:${Math.round(meta.avgWPM ?? 0)} / Time:${Math.round(meta.playTimeSec ?? 0)}s`;
      this.el.querySelector('#lexi-total').textContent = total;

      // KPIチップ
      const k = this.el.querySelector('#lexi-kpis');
      k.innerHTML = '';
      k.append(this._chip(`正解 ${correct}`));
      k.append(this._chip(`ミス ${mistakes}`));
      k.append(this._chip(`精度 ${(accuracy * 100).toFixed(1)}%`));

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
    }

    hide() {
      this.el.style.display = 'none';
    }

    _chip(text) {
      const s = document.createElement('span');
      s.className = 'lexi-chip';
      s.textContent = text;
      return s;
    }

    _label(t) { return (new ScoreTracker()).label(t); }

    // ←← ここを「X へ直接共有」に固定
    _share() {
      const text = this.tracker.toTweetText({
        gameName: this.meta.gameName || 'LexiBlaster',
        level: this.meta.levelName || 'N/A',
        avgWPM: Math.round(this.meta.avgWPM || 0)
      });

      const params = new URLSearchParams({
        text,
        url: this.url,
        hashtags: ['LexiBlaster', '英単語ゲーム'].join(',')
      });

      // X の投稿画面を直接開く（ブロックされたら twitter.com をフォールバック）
      const xUrl  = 'https://x.com/intent/post?' + params.toString();
      const twUrl = 'https://twitter.com/intent/tweet?' + params.toString();
      const w = window.open(xUrl, '_blank', 'noopener,noreferrer');
      if (!w) window.open(twUrl, '_blank', 'noopener,noreferrer');
    }
  }

  // export
  window.ScoreTracker = ScoreTracker;
  window.ScoreboardOverlay = ScoreboardOverlay;
})();
