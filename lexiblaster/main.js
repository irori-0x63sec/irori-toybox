// === main.js ===
// AvgWPM計測＋速度ボーナス / BGM: WebAudioでシームレスループ
// フォント/アセット読み込み完了まで Canvas を非表示にしてチラつき回避

const VOCAB_FILES = {
  A: "data/en_en_A.json",
  B: "data/en_en_B.json",
  C: "data/en_en_C.json",
};

const SCORE_PLUS  = 100;
const SCORE_MINUS = 5;
const MAX_SCORE   = 999999;

let currentLevel = "A1";
let currentBand  = "A";
let currentMode  = "en_en";

let weakOnly = false;
let srsMode  = true;

let wordList   = [];
let activeList = [];
let idx = 0;

let score = 0;
let lives = 3;
let isGameOver = false;
let revealed = [];
let startedAt = 0;

/* =========================================================
   BGM manager (WebAudioでサンプル精度ループ)
   - 以前の HTMLAudio + timeupdate を全置換
   - ループ範囲は BGM_LOOP_START / BGM_LOOP_END で調整
   - ♬トグルは toggleBGMMute() / isBGMMuted() を経由
========================================================= */
let bgmReady = false, bgmStarted = false;
let bgmMuted = false, sfxMuted = false;
let sfxVolumeSaved = 1;

const BGM_SRC = 'sounds/bgm_main.mp3';
const BGM_LOOP_START = 0.0;   // ループ開始（秒）
const BGM_LOOP_END   = 0;   // ループ終了（秒） 0ならファイル末尾
const BGM_VOLUME     = 0.40;  // 基本音量
const LOOP_PAD       = 0.030; // クリック対策のパッド(0.03〜0.07で調整)

// WebAudio 内部
let _ctx, _gain, _buffer, _src;

// 近傍のゼロクロスへスナップ（ポップノイズ低減）
function _snapZero(buffer, timeSec, prefer = 'forward', searchMs = 30) {
  if (!buffer) return timeSec;
  const ch = buffer.getChannelData(0);
  const sr = buffer.sampleRate;
  let i = Math.max(1, Math.min(ch.length - 2, Math.floor(timeSec * sr)));
  const span = Math.floor(searchMs * sr / 1000);
  const dir = (prefer === 'backward') ? -1 : 1;

  for (let k = 0; k <= span; k++) {
    const idx = i + dir * k;
    if (idx < 1 || idx >= ch.length - 1) break;
    const a = ch[idx - 1], b = ch[idx];
    if (a === 0 || b === 0 || (a > 0 && b < 0) || (a < 0 && b > 0)) {
      return idx / sr;
    }
  }
  return timeSec;
}

async function initBGM(){
  if (bgmReady) return;

  // 既存のミュート状態をロード
  try { bgmMuted = (localStorage.getItem('bgmMuted') === '1'); } catch {}

  _ctx  = _ctx  || new (window.AudioContext || window.webkitAudioContext)();
  _gain = _gain || _ctx.createGain();
  _gain.gain.value = bgmMuted ? 0 : BGM_VOLUME;
  _gain.connect(_ctx.destination);

  // iOS/ブラウザ対策：初回操作で resume
  const resume = ()=> _ctx.resume().catch(()=>{});
  window.addEventListener('pointerdown', resume, { once:true, capture:true });
  window.addEventListener('keydown',     resume, { once:true, capture:true });

  // デコード
  const res = await fetch(BGM_SRC, { cache: 'no-store' });
  const arr = await res.arrayBuffer();
  _buffer = await _ctx.decodeAudioData(arr);

  bgmReady = true;
}

function _startSource(){
  if (!_buffer) return;

  // 既存を停止して作り直し（BufferSourceは使い捨て）
  if (_src) { try{ _src.stop(); }catch{}; _src.disconnect(); _src = null; }

  const dur = _buffer.duration;
  const rawStart = Math.max(0, BGM_LOOP_START + LOOP_PAD);
  const rawEnd   = Math.min(dur, (BGM_LOOP_END > 0 ? BGM_LOOP_END : dur) - LOOP_PAD);

  // 始点は「前方」・終点は「後方」に少しだけ寄せてゼロクロスへ
  const loopStart = _snapZero(_buffer, rawStart, 'forward', 30);
  const loopEnd   = _snapZero(_buffer, rawEnd,   'backward', 30);
  const validLoop = loopEnd > loopStart + 0.005;

  _src = _ctx.createBufferSource();
  _src.buffer = _buffer;
  _src.loop = true;
  if (validLoop) {
    _src.loopStart = loopStart;
    _src.loopEnd   = loopEnd;
  }
  _src.connect(_gain);
  _src.start(0, validLoop ? loopStart : 0);
}

function startBGM(){
  if (!bgmReady) return;
  _startSource();
  bgmStarted = true;
}
function stopBGM(){
  if (_src) { try{ _src.stop(); }catch{}; _src.disconnect(); _src = null; }
  bgmStarted = false;
}
function toggleBGMMute(){
  bgmMuted = !bgmMuted;
  const t = _ctx ? _ctx.currentTime : 0;
  if (_gain) _gain.gain.setTargetAtTime(bgmMuted ? 0 : BGM_VOLUME, t, 0.02);
  try { localStorage.setItem('bgmMuted', bgmMuted ? '1' : '0'); } catch {}
}
function isBGMMuted(){ return !!bgmMuted; }
/* ========================================================= */

//
// ---- スコア内訳 ----
const Score = {
  tracker: new window.ScoreTracker(),
  overlay: new window.ScoreboardOverlay(),
  add(delta, type='OTHER', meta={}){
    score = clamp0(score + delta);
    updateHUD();
    this.tracker.record(type, delta, meta);
  }
};
Score.overlay.onRestart = () => onRestart();

//
// ---- タイピング速度 ----
const Typing = {
  firstKeyAt: null,
  samples: [],
  reset(){ this.firstKeyAt=null; this.samples.length=0; },
  onInputChange(val){ if (!this.firstKeyAt && (val||'').length>0) this.firstKeyAt = performance.now(); },
  onNewWord(){ this.firstKeyAt = null; },
  onSolved(answer){
    if(!this.firstKeyAt) return 0;
    const ms  = performance.now() - this.firstKeyAt;
    const wpm = ((answer.length/5) / (ms/60000));
    this.samples.push(wpm);
    this.firstKeyAt = null;
    return wpm;
  },
  avgWPM(){ return this.samples.length ? this.samples.reduce((a,b)=>a+b,0)/this.samples.length : 0; }
};

//
// ---- 苦手度（SRS） ----
const LS_KEY = "lb_scores_v1";
let userScores = {};
function loadScores(){ try { userScores = JSON.parse(localStorage.getItem(LS_KEY) || "{}"); } catch { userScores = {}; } }
function saveScores(){ try { localStorage.setItem(LS_KEY, JSON.stringify(userScores)); } catch {} }
function keyNew(w){ const ans = (w.answer_en || w.answer || "").toLowerCase(); return `${currentBand}:${w.level}:${ans}`; }
function keyOld(w){ const ans = (w.answer_en || w.answer || "").toLowerCase(); return `${currentBand}:${ans}`; }
function getScore(w){
  const kN = keyNew(w); if (userScores[kN]?.score != null) return (userScores[kN].score|0);
  const kO = keyOld(w); if (userScores[kO]?.score != null) return (userScores[kO].score|0);
  return 0;
}
function setScore(w, v){ const k = keyNew(w); userScores[k] = { score: Math.max(-10, Math.min(10, v|0)) }; }
function incScore(w, delta){ setScore(w, getScore(w) + delta); }

//
// ---- util ----
const clamp0 = (n)=>Math.max(0,n);
const clamp  = (n,lo,hi)=>Math.min(Math.max(n,lo),hi);
function lettersHint(answer, revealedIdx){
  return answer.split("").map((ch,i)=> (revealedIdx.includes(i)?ch:"_")).join(" ");
}

//
// ---- リスト構築 ----
function buildActiveList(){
  activeList = wordList.filter(w => w.level === currentLevel);
  if (!activeList.length) activeList = wordList.filter(w => (w.band || currentBand) === currentBand);
  idx = 0;
}

//
// ---- 次の問題（重み） ----
function pickNextIndex(){
  if(!activeList.length) return 0;
  const candidates = activeList
    .map((w,i)=>({ w,i,s:getScore(w) }))
    .filter(o=>{
      if (weakOnly && o.s < 0)  return false;
      if (srsMode  && o.s < -3) return false;
      return true;
    });
  if(!candidates.length) return Math.floor(Math.random()*activeList.length);
  const weights = candidates.map(({w,s})=>{
    const cs = w.correctStreak ?? 0;
    const lm = w.lastMistake   ?? 99;
    let weight = 1;
    if (lm===0) weight *= 2;
    if (cs>=2)  weight *= 0.5;
    if (s>=0)   weight *= (1+s);
    return Math.max(weight,0.001);
  });
  const total = weights.reduce((a,b)=>a+b,0) || 1;
  let r = Math.random()*total;
  for(let k=0;k<candidates.length;k++){ r -= weights[k]; if(r<=0) return candidates[k].i; }
  return candidates[candidates.length-1].i;
}

//
// ---- Canvas連携 ----
function updateHUD(){ window.canvasGame?.setHUD(score,lives); }
function updateHintsTopBottom(topText,bottomText){ window.canvasGame?.setHints(topText,bottomText); }
function getQA(w){
  if (!w) return { top: "Hint: —", answer: "" };
  const enAns  = (w.answer_en || w.answer || "").toLowerCase();
  const jaAns  = (w.answer_jp || w.answer_ja || "").toLowerCase();
  const hintEN = (w.hint_en || w.hint || "").trim();
  const hintJA = (w.hint_ja || "").trim();
  return (currentMode==="jp_en") ? { top:`ヒント: ${hintJA || "—"}`, answer: enAns }
       : (currentMode==="en_jp") ? { top:`Hint: ${hintEN || "—"}`,   answer: jaAns }
                                 : { top:`Hint: ${hintEN || "—"}`,   answer: enAns };
}

//
// ---- 出題 ----
function loadWord(){
  if(!activeList.length || isGameOver) return;
  revealed=[];
  const w = activeList[idx];
  const { top, answer } = getQA(w);
  const bottom = lettersHint(answer, revealed);
  updateHintsTopBottom(top, bottom);
  window.canvasGame?.spawnMeteor();
  window.canvasGame?.setInput("");
  Typing.onNewWord();
  window.canvasGame?.focusInput(true);
}

//
// ---- 判定 ----
function handleCorrect(){
  const w = activeList[idx];
  const { answer } = getQA(w);
  Typing.onSolved(answer);

  Score.add(+SCORE_PLUS, 'CORRECT', { word: (w.answer_en || w.answer || '').toLowerCase() });
  w.correctStreak = (w.correctStreak||0) + 1;
  w.lastMistake   = 99;
  incScore(w, -1); saveScores();

  window.canvasGame?.blastLastMeteor();
  setTimeout(()=>{ idx = pickNextIndex(); loadWord(); }, 800);
}
function handleWrong(){
  const w = activeList[idx];
  const { answer, top } = getQA(w);
  const en = (w.answer_en || w.answer || '').toLowerCase();
  const ja = (w.answer_jp || w.answer_ja || '').trim();
  const userNow = (window.canvasGame?.getInput?.() || "").trim();

  Score.add(-SCORE_MINUS, 'MISTAKE', { expect: answer, en, ja, hint: top, got: userNow });

  const pool=[...Array(answer.length).keys()].filter(i=>!revealed.includes(i));
  if(pool.length>0){ const p=pool[Math.floor(Math.random()*pool.length)]; revealed.push(p); }
  const bottom = lettersHint(answer, revealed);
  updateHintsTopBottom(top,bottom);

  w.correctStreak = 0;
  w.lastMistake   = 0;
  incScore(w, +1); saveScores();
}

//
// ---- メニュー選択/トグル ----
function onSelectLevel(levelKey){ currentLevel = levelKey; currentBand = levelKey[0]; }
function onSelectLang(key){ currentMode = key; }
function onToggleWeak(on){ weakOnly = !!on; }
function onToggleSRS(on){  srsMode  = !!on; }

async function onStartGame(){
  try{
    loadScores();
    const path = VOCAB_FILES[currentBand] || VOCAB_FILES.A;
    const res  = await fetch(path);
    if (!res.ok) { updateHintsTopBottom("Hint: (load error)", ""); return; }

    wordList   = await res.json();
    for(const w of wordList){
      if(typeof w.correctStreak!=="number") w.correctStreak=0;
      if(typeof w.lastMistake!=="number")   w.lastMistake=99;
      if(!w.band)  w.band  = currentBand;
      if(!w.level) w.level = `${currentBand}1`;
    }
    buildActiveList();

    score=0; lives=3; isGameOver=false;
    Score.tracker.reset(); Typing.reset();
    startedAt = performance.now(); updateHUD();

    idx = pickNextIndex();
    loadWord();
  }catch(e){
    console.error("[onStartGame] error", e);
    updateHintsTopBottom("Hint: (load error)", "");
  }
}

function onRestart(){
  try { Score.overlay.hide(); } catch(_) {}
  score=0; lives=3; isGameOver=false;
  Typing.reset();
  window.canvasGame?.setFlow({ started:true, gameOver:false, phase:"countdown" });
  updateHUD();
}
function onReturnToTitle(){
  try { Score.overlay.hide(); } catch(_) {}
  score=0; lives=3; isGameOver=false;
  Typing.reset();
  window.canvasGame?.resetScene?.();
  window.canvasGame?.setFlow({ started:true, gameOver:false, phase:"selectLevel" });
  window.canvasGame?.setHints("Hint: —", "");
  window.canvasGame?.focusInput(false);
  updateHUD();
}
function onBlast(inputStr){
  if(isGameOver) return;
  const w = activeList[idx]; if (!w) return;
  const { answer } = getQA(w);
  const user=(inputStr||"").trim().toLowerCase();
  if(user===answer) handleCorrect(); else handleWrong();
}

//
// ---- Baseヒット → GameOver ----
window.addEventListener("meteorHitBase", ()=>{
  if(isGameOver) return;
  lives = clamp0(lives-1); updateHUD();
  Score.tracker.record('LIFE_LOST', 0, { lives });
  window.canvasGame?.baseHitFlash?.();

  if(lives<=0){
    isGameOver=true;
    window.canvasGame?.setFlow({ gameOver:true, started:true, phase:"gameover" });
    const w = activeList[idx];
    const { top, answer } = getQA(w);
    updateHintsTopBottom(top, `Answer: ${answer}`);
    window.canvasGame?.focusInput(false);

    const avgWPM = Typing.avgWPM();
    // ※速度ボーナスは現状のロジックをそのまま利用
    const speedBonus = Math.max(0, Math.round((avgWPM - 20) * 1));
    if (speedBonus > 0) {
      Score.tracker.record('SPEED_BONUS', speedBonus, { avgWPM: Math.round(avgWPM) });
      score = clamp0(score + speedBonus); updateHUD();
    }
    const meta = {
      gameName: 'LexiBlaster',
      levelName: currentLevel,
      avgWPM, playTimeSec: (performance.now() - startedAt)/1000
    };
    Score.overlay.show({ tracker: Score.tracker, meta, url: location.href});
  } else {
    window.canvasGame?.spawnMeteor();
  }
});

//
// ---- Font & Canvas visibility ----
function hideCanvas() {
  const c = document.getElementById('gameCanvas');
  if (c) c.style.visibility = 'hidden';
}
function showCanvas() {
  const c = document.getElementById('gameCanvas');
  if (c) c.style.visibility = 'visible';
}
async function waitForPixelFont(timeoutMs = 4000) {
  if (!('fonts' in document)) return;
  const fam = '"Press Start 2P"';
  const loads = [
    document.fonts.load(`16px ${fam}`),
    document.fonts.load(`24px ${fam}`),
    document.fonts.load(`48px ${fam}`)
  ];
  try {
    await Promise.race([
      (async () => { await Promise.all(loads); await document.fonts.ready; })(),
      new Promise(res => setTimeout(res, timeoutMs))
    ]);
  } catch {}
}

//
// ---- 起動（canvasGame存在確認→start→フォント待ち→タイトル→BGM起動） ----
(async function boot(){
  hideCanvas();
  await new Promise((resolve) => {
    function check() {
      if (window.canvasGame && typeof window.canvasGame.start === 'function') return resolve();
      requestAnimationFrame(check);
    }
    check();
  });

  window.canvasGame.bindCallbacks({
    onSelectLevel, onSelectLang, onStartGame, onRestart, onBlast,
    onInputChange: (v)=>Typing.onInputChange(v),
    onToggleWeak, onToggleSRS,
    onReturnToTitle,
  });

  await window.canvasGame.start();
  await waitForPixelFont(4000);

  // タイトル表示
  window.canvasGame.setFlow({ started: false, gameOver: false, phase: 'title' });
  showCanvas();

  // ===== BGM: WebAudio初期化＆スタート =====
  try {
    await initBGM();
    startBGM(); // コンテキストがサスペンド中でも走らせておく（初回操作でresume）
  } catch (e) { console.warn('[BGM] init/start failed', e); }

  // ♬UIフック
  window.AudioUI = {
    toggleBGM: () => { try { toggleBGMMute(); } catch(_){} },
    isBGMMuted: () => { try { return isBGMMuted(); } catch(_) { return false; } }
  };
})();
