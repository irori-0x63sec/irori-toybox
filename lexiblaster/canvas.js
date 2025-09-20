// === canvas.js ===
// タイトル/レベル選択/カウントダウン/プレイ/結果
// 安全入力・英日両対応・ミュートUI(♬)・メテオ/爆発/尾・Base差分 + Help(?)

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

/* ==== Help Button & Overlay ===================================== */
/*  使い方:
    1) 本ファイル内で initHelp(canvas) を一度呼出し（下で呼んでます）
    2) 毎フレームの最後に drawHelp(ctx, canvas) を呼出し（下のループ内で呼んでます）
    3) 位置は音符ボタンのすぐ左（右上）に配置
*/
const HELP = {
  visible: false,
  x: 0, y: 0, r: 18,
  offsetFromRightPx: 56,  // 音符から左に少し
  marginTopPx: 12
};
function initHelp(canvas) {
  const updateHelpPos = () => {
    const base = Math.min(canvas.width, canvas.height);
    HELP.r = Math.min(22, Math.max(16, Math.round(base * 0.028)));
    HELP.x = canvas.width - HELP.offsetFromRightPx - HELP.r;
    HELP.y = HELP.marginTopPx + HELP.r;
  };
  updateHelpPos();
  window.addEventListener('resize', updateHelpPos);

  canvas.addEventListener('click', (e) => {
    const { x, y } = getCanvasPointerPos(canvas, e);

    // オーバーレイ表示中はどこでも閉じる
    if (HELP.visible) { HELP.visible = false; return; }

    // ?ボタン命中
    if (isHit(x, y, HELP.x, HELP.y, HELP.r)) {
      HELP.visible = true;
      return;
    }
  });
}
function drawHelp(ctx, canvas) {
  drawHelpButton(ctx);
  if (HELP.visible) drawHelpOverlay(ctx, canvas);
}
function drawHelpButton(ctx) {
  ctx.save();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.fillStyle   = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.arc(HELP.x, HELP.y, HELP.r, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `${Math.round(HELP.r * 1.2)}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('?', HELP.x, HELP.y + (HELP.r * 0.05));
  ctx.restore();
}
function drawHelpOverlay(ctx, canvas) {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.78)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pad = 20;
  const cardW = Math.min(canvas.width * 0.9, 720);
  const cardH = Math.min(canvas.height * 0.75, 420);
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;
  const x = Math.round(cx - cardW / 2);
  const y = Math.round(cy - cardH / 2);
  const r = 14;

  roundRect(ctx, x, y, cardW, cardH, r);
  ctx.fillStyle = 'rgba(30,32,36,0.95)';
  ctx.fill();

  ctx.fillStyle = '#fff';
  const titleSize = 22;
  const bodySize  = 16;
  ctx.font = `600 ${titleSize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';

  const tx = x + pad;
  let ty  = y + pad;

  ctx.fillText('遊び方 – Lexi Blaster', tx, ty);
  ty += titleSize + 12;

  ctx.font = `${bodySize}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
    const lines = [
      '1) 画面上のヒントを見て、正解の単語をタイプします。',
      '2) Enter（または発射ボタン）で解答を送信。正解でスコア+、ミスでヒントの文字が1つ開きます。',
      '3) ライフが0になるとゲームオーバー。スコアはXで共有できます。',
      '',
      '※ 画面のどこか（キャンバス内）をクリック/タップすると説明を閉じます。'
    ];

  const lineGap = 8;
  for (const line of lines) {
    ctx.fillText(line, tx, ty);
    ty += bodySize + lineGap;
  }
  ctx.restore();
}
function roundRect(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y,     x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x,     y + h, rr);
  ctx.arcTo(x,     y + h, x,     y,     rr);
  ctx.arcTo(x,     y,     x + w, y,     rr);
  ctx.closePath();
}
function getCanvasPointerPos(canvas, e) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width  / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (e.clientX - rect.left) * scaleX,
    y: (e.clientY - rect.top)  * scaleY
  };
}
function isHit(px, py, cx, cy, r) {
  const dx = px - cx, dy = py - cy;
  return (dx * dx + dy * dy) <= (r * r);
}
/* ================================================================ */

// ---- Secure Hidden Input for JP/EN typing ----
const hidden = document.createElement('input');
hidden.type = 'text';
hidden.autocomplete = 'off';
hidden.autocapitalize = 'off';
hidden.spellcheck = false;
hidden.inputMode = 'text';
Object.assign(hidden.style, {
  position:'fixed', left:'0', top:'0',
  width:'1px', height:'1px', opacity:'0',
  pointerEvents:'none', background:'transparent',
  color:'transparent', border:'0'
});
hidden.style.caretColor = 'transparent';
document.body.appendChild(hidden);

let isComposing = false;
hidden.addEventListener('compositionstart', ()=>{ isComposing = true; });
hidden.addEventListener('compositionend',   ()=>{ isComposing = false; });

const ALLOWED_RE = /[A-Za-z\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\u3005\u30FC]+/g;
const ZERO_WIDTH_RE = /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
function sanitize(str, maxLen=64){
  const nfkc = (str||"").normalize('NFKC').replace(ZERO_WIDTH_RE,'');
  const clean = (nfkc.match(ALLOWED_RE) || []).join('');
  return clean.slice(0, maxLen);
}
hidden.addEventListener('paste', (e)=>{
  e.preventDefault();
  const t = (e.clipboardData && e.clipboardData.getData('text')) || '';
  const clean = sanitize(t);
  hidden.value = clean;
  model.input = clean;
});
hidden.addEventListener('input', ()=>{
  const clean = sanitize(hidden.value);
  if (clean !== hidden.value){
    hidden.value = clean;
    try{ hidden.setSelectionRange(clean.length, clean.length); }catch(_){}
  }
  model.input = clean;
  if (typeof model.onInputChange === 'function') model.onInputChange(model.input);
});
window.addEventListener('dragover', e=> e.preventDefault());
window.addEventListener('drop',     e=> e.preventDefault());
document.addEventListener('keydown', (e)=>{
  const vKey = (e.ctrlKey||e.metaKey) && (e.key==='v' || e.key==='V');
  if (vKey) e.preventDefault();
}, {capture:true});

const _origSetInput   = setInput;
const _origFocusInput = focusInput;
setInput = function(s){
  const clean = sanitize(s);
  _origSetInput(clean);
  hidden.value = clean;
};
focusInput = function(on){
  _origFocusInput(on);
  if (on) {
    const focusHidden = () => {
      try {
        hidden.focus({ preventScroll:true });
        const len = hidden.value.length;
        try { hidden.setSelectionRange(len, len); } catch(_){}
      } catch(_){}
    };
    try { requestAnimationFrame(() => setTimeout(focusHidden, 0)); } catch(_){}
  } else { try{ hidden.blur(); }catch(_){ } }
};

// ---- Canvas size ----
const CANVAS_W = 800;
const PLAYFIELD_H = 600;
const FOOTER_H   = 120;
const CANVAS_H   = PLAYFIELD_H + FOOTER_H;
canvas.width = CANVAS_W; canvas.height = CANVAS_H;

// ---- Assets ----
const images = {};
const toLoad = [
  ["meteor","assets/meteor.png"],
  ["base","assets/base.png"],
  ["boom","assets/boom.png"],
  ["back","assets/back.png"],
  ["heart","assets/heart.png"],
  ["btn_blast","assets/btn_blast.png"],
  // damage overlays
  ["crack1","assets/base_crack1.png"], // 静止
  ["crack2","assets/base_crack2.png"], // 4フレーム縦
  ["smoke1","assets/base_smoke1.png"], // 3フレーム縦
];
const sfx = {
  blast:    new Audio('sounds/blast.wav'),
  gameover: new Audio('sounds/gameover.wav'),
};
sfx.blast.volume = 0.3; sfx.gameover.volume = 1.0;
window.canvasGameSFX = sfx;

const FPS = 3;
const FRAME_DURATION = 1000 / FPS;
let baseFrameCount   = 1;
let meteorFrameCount = 3;
let boomFrameCount   = 4;

const STAR_COUNT = 14;
const stars     = [];
const meteors   = [];
const explosions= [];

// 爆発スケール
const EXPLOSION_SCALE = 2;
const METEOR_RADIUS_FACTOR = 0.45;

// --- Trail particles ---
const trailParticles = [];
const TRAIL_MAX = 600;
const TRAIL_EMIT_BASE = 80;
const TRAIL_SPEED_BIAS = 0.6;
const TRAIL_LIFE_MIN = 0.25, TRAIL_LIFE_MAX = 0.55;
const TRAIL_SIZE_MIN = 1, TRAIL_SIZE_MAX = 3;
const TRAIL_COLS = ['#fff1a8','#ffd166','#ff9f43','#ff6b3d','#ff3b2f'];

// ---- UI Layout ----
const BTN_BACK = { x: 20, y: 84, w: 100, h: 36 };

const gridLevels = [
  ["A1","A2","A3"],
  ["B1","B2","B3"],
  ["C1","C2","C3"],
];

const BTN_W = 80, BTN_H = 80;
const GAP_X = 24, GAP_Y = 24;
const GRID_COLS = 3;
const gridW  = BTN_W * GRID_COLS + GAP_X * (GRID_COLS - 1);
const gridX0 = CANVAS_W / 2 - gridW / 2;
const gridY0 = 190;

const levelGrid = gridLevels.flat().map((key, idx) => {
  const col = idx % GRID_COLS;
  const row = Math.floor(idx / GRID_COLS);
  const x = gridX0 + col * (BTN_W + GAP_X);
  const y = gridY0 + row * (BTN_H + GAP_Y);
  return { key, x, y, w: BTN_W, h: BTN_H, row, col };
});

const rowLabels = ["EASY","NORMAL","HARD"];

// Filters
const RIGHT_MARGIN_MIN = 60;
const TOGGLE_W = 110, TOGGLE_H = 30;
let togglesX = gridX0 + gridW + RIGHT_MARGIN_MIN;
togglesX = Math.min(togglesX, CANVAS_W - TOGGLE_W - 20);

const toggles = [
  { label: "WEAK", x: togglesX, y: gridY0 + 10, w: TOGGLE_W, h: TOGGLE_H, key: "weakOnly", on: false },
];
const FILTERS_TITLE_X = togglesX + TOGGLE_W/2;
const FILTERS_TITLE_Y = gridY0 - 20;

// Footer UI
const UI = {
  scorePos: { x: 20, y: PLAYFIELD_H + 8 },
  livesPos: { x: 20, y: PLAYFIELD_H + 36 },
  hintMeaning: { x: 20, y: PLAYFIELD_H + 10, maxW: CANVAS_W - 40 },
  hintLetters: { x: 20, y: PLAYFIELD_H + 42, maxW: CANVAS_W - 40 },
  inputBox:    { x: 220, y: PLAYFIELD_H + 74, w: 440, h: 32 },
  btnBlast:    { x: 670, y: PLAYFIELD_H + 70, w: 100, h: 40 },
};

// ---- 共有モデル ----
const model = {
  phase: "title", // title → selectLevel → selectLang → countdown → playing → gameover
  started: false,
  gameOver: false,

  score: 0,
  lives: 3,

  hintMeaningText: "Hint: —",
  hintLettersText: "_______",

  input: "",
  inputFocus: false,

  selectedLevel: null,
  selectedLang:  null,
  weakOnly: false,

  // countdown（1秒刻み "3","2","1","START"）
  cdIndex: -1,
  cdTimer: 0,
  cdLabels: ["3","2","1","START"],

  // Base hit flash
  baseFlash: 0,

  // callbacks
  onSelectLevel: null,
  onSelectLang:  null,
  onStartGame:   null,
  onBlast:       null,
  onRestart:     null,
  onToggleWeak:  null,
  onReturnToTitle: null,
  onInputChange: null,
};

// ---- API for main.js ----
function setHUD(score, lives){ model.score = score; model.lives = lives; }
function setHints(meaning, letters){ model.hintMeaningText = meaning; model.hintLettersText = letters; }
function setInput(str){ model.input = str; }
function focusInput(f = true){ model.inputFocus = f; }
function beginCountdown(){ model.cdIndex = 0; model.cdTimer = 1.0; }
function setFlow(data){
  const prevPhase    = model.phase;
  const prevGameOver = model.gameOver;
  Object.assign(model, data);
  if ((!prevGameOver && model.gameOver) || (prevPhase !== 'gameover' && model.phase === 'gameover')) {
    try { sfx.gameover.currentTime = 0; sfx.gameover.play(); } catch(_){}
  }
  if (prevPhase !== 'countdown' && model.phase === 'countdown') beginCountdown();
}
function bindCallbacks(cbs){ Object.assign(model, cbs); }

// ---- Assets ----
function loadImage(key, src){
  return new Promise((resolve)=>{
    const img = new Image();
    img.onload = ()=>{ images[key] = img; resolve(); };
    img.onerror = ()=> resolve();
    img.src = src;
  });
}
async function loadAssets(){ for(const [k,s] of toLoad){ await loadImage(k,s); } }

function initStars(){
  stars.length = 0;
  for(let i=0;i<STAR_COUNT;i++){
    stars.push({
      x: Math.random()*CANVAS_W,
      y: Math.random()*(PLAYFIELD_H*0.5),
      arm: Math.random()*5+6,
      thick: Math.random()*0.6+0.5,
      phase: Math.random()*Math.PI*2,
      twinkle: Math.random()*0.002+0.001,
      diag: Math.random()<0.35
    });
  }
}

// ---- Draw helpers ----
function drawPixelText(text,x,y,size=12,align='left',color='#fff'){
  ctx.save();
  ctx.font = `${size}px "Press Start 2P", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const ix = Math.round(x), iy = Math.round(y);
  ctx.fillStyle='#000';
  ctx.fillText(text, ix+1, iy);
  ctx.fillText(text, ix-1, iy);
  ctx.fillText(text, ix, iy+1);
  ctx.fillText(text, ix, iy-1);
  ctx.fillStyle=color;
  ctx.fillText(text, ix, iy);
  ctx.restore();
}
function drawPixelTextSkew(text,x,y,size=48,align='center',color='#ff9f43',skew=-0.32){
  ctx.save();
  ctx.translate(Math.round(x), Math.round(y));
  ctx.transform(1, 0, skew, 1, 0, 0);
  ctx.font = `${size}px "Press Start 2P", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.fillStyle='#000';
  ctx.fillText(text, 1, 0);
  ctx.fillText(text,-1, 0);
  ctx.fillText(text, 0, 1);
  ctx.fillText(text, 0,-1);
  ctx.fillStyle=color;
  ctx.fillText(text, 0, 0);
  ctx.restore();
}
function drawRectButton(x,y,w,h,label,primary=false,active=false, fontSize=10){
  ctx.save();
  ctx.fillStyle = primary ? (active ? '#0e3a52' : '#143a4f') : (active ? '#203040' : '#1b2a38');
  ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = active ? '#9ee6ff' : '#5cd4ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
  drawPixelText(label, x+w/2, y+(h-fontSize)/2, fontSize, 'center', '#5cd4ff');
  ctx.restore();
}
function drawRectButtonFit(x,y,w,h,label,primary=false,active=false, fontSize=12, padding=10){
  ctx.save();
  ctx.fillStyle = primary ? (active ? '#0e3a52' : '#143a4f') : (active ? '#203040' : '#1b2a38');
  ctx.fillRect(x,y,w,h);
  ctx.strokeStyle = active ? '#9ee6ff' : '#5cd4ff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);

  let fs = fontSize;
  const maxTextWidth = w - padding*2;
  while (fs > 8) {
    ctx.font = `${fs}px "Press Start 2P", monospace`;
    if (ctx.measureText(label).width <= maxTextWidth) break;
    fs--;
  }
  drawPixelText(label, x+w/2, y+(h-fs)/2, fs, 'center', '#5cd4ff');
  ctx.restore();
}
function drawWrappedText(text, x, y, maxW, size=10, align='left', color='#fff') {
  if (!text) return;
  ctx.save();
  ctx.font = `${size}px "Press Start 2P", monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  const words = text.split(" ");
  let line = "", lineH = size + 4, yy = y;
  for (let n=0; n<words.length; n++) {
    const testLine = line + words[n] + " ";
    const testWidth = ctx.measureText(testLine).width;
    if (testWidth > maxW && n > 0) {
      ctx.fillStyle='#000'; ctx.fillText(line, x+1, yy); ctx.fillText(line, x-1, yy);
      ctx.fillText(line, x, yy+1); ctx.fillText(line, x, yy-1);
      ctx.fillStyle=color;  ctx.fillText(line, x, yy);
      line = words[n] + " "; yy += lineH;
    } else line = testLine;
  }
  ctx.fillStyle='#000'; ctx.fillText(line, x+1, yy); ctx.fillText(line, x-1, yy);
  ctx.fillText(line, x, yy+1); ctx.fillText(line, x, yy-1);
  ctx.fillStyle=color;  ctx.fillText(line, x, yy);
  ctx.restore();
}
/** 縦スプライトストリップを「幅フィット＋等比」で描画（ベース矩形でクリップ＆下寄せ） */
function drawStripFitWidth(img, frames, fps, rect, verticalAlign='bottom', alpha=1.0){
  const t   = performance.now() / 1000;
  const idx = frames > 1 ? Math.floor(t * fps) % frames : 0;
  const fh  = img.height / frames;
  const scale = rect.w / img.width;
  const dw  = rect.w;
  const dh  = fh * scale;
  const dx  = rect.x;
  const dy  = (verticalAlign === 'bottom') ? (rect.y + rect.h - dh) : rect.y;

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  ctx.globalAlpha = alpha;
  ctx.drawImage(img, 0, fh*idx, img.width, fh, dx, dy, dw, dh);
  ctx.restore();
}

// ---- Scene drawing helpers ----
function meteorRadius(){ const m=images["meteor"]; if(!m) return 24; return Math.max(m.width, (m.height/meteorFrameCount))*0.45; }
function baseRect(){ const base=images["base"]; if(!base) return { x: CANVAS_W/2-32, y: PLAYFIELD_H-64, w: 64, h: 64 }; const w=base.width, h=base.height/baseFrameCount; const x=(CANVAS_W - w)/2, y=PLAYFIELD_H - h; return { x,y,w,h }; }
function baseCenter(){ const r=baseRect(); return { bx:r.x+r.w/2, by:r.y+r.h/2 }; }
function baseRadius(){ const r=baseRect(); return Math.max(r.w,r.h)*0.5; }

function drawBackground(){
  const back = images["back"];
  if (back) ctx.drawImage(back, 0, 0, CANVAS_W, PLAYFIELD_H);
  else { ctx.fillStyle='#081018'; ctx.fillRect(0,0,CANVAS_W,PLAYFIELD_H); }
  ctx.fillStyle='#0b1520'; ctx.fillRect(0, PLAYFIELD_H, CANVAS_W, FOOTER_H);
  ctx.strokeStyle='#183048'; ctx.strokeRect(0.5, PLAYFIELD_H+0.5, CANVAS_W-1, FOOTER_H-1);
}

// Base排他表示
function drawBase(){
  const r = baseRect();
  const lives = (model.lives | 0);
  const isKO  = model.gameOver || lives <= 0;

  let img = null, frames = 1, fps = 0, useFitWidth = false;
  if (!isKO && lives >= 3) {
    img = images["base"]; frames = 1; fps = 0; useFitWidth = false;
  } else if (lives === 2) {
    img = images["crack1"]; frames = 1; fps = 0; useFitWidth = true;
  } else if (lives === 1) {
    img = images["crack2"]; frames = 4; fps = 6; useFitWidth = true;
  } else if (isKO) {
    img = images["smoke1"]; frames = 3; fps = 5; useFitWidth = true;
  }

  if (img) {
    if (useFitWidth) {
      drawStripFitWidth(img, frames, fps, r, 'bottom', 1.0);
    } else {
      const fh  = img.height / frames;
      const idx = frames > 1 ? (Math.floor((performance.now()/1000) * fps) % frames) : 0;
      ctx.drawImage(img, 0, fh * idx, img.width, fh, r.x, r.y, r.w, r.h);
    }
  } else {
    ctx.fillStyle = '#4ff'; ctx.fillRect(r.x, r.y, r.w, r.h);
  }

  if (model.baseFlash > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(model.baseFlash, 0.6);
    ctx.fillStyle = "#ff4444";
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.restore();
  }
}

function drawMeteor(m,frame){
  const spr=images["meteor"];
  if(spr){
    const h = spr.height / meteorFrameCount;
    const w = spr.width;
    const sx = 0, sy = h*frame;
    ctx.save();
    ctx.translate(m.x, m.y);
    if (typeof m.angle === 'number') ctx.rotate(m.angle);
    ctx.drawImage(spr, sx, sy, w, h, -w/2, -h/2, w, h);
    ctx.restore();
  } else {
    ctx.fillStyle='#aaa';
    ctx.beginPath(); ctx.arc(m.x, m.y, m.radius, 0, Math.PI*2); ctx.fill();
  }
}

function explosionSizeFromMeteor(m){
  const r = (m && m.radius) ? m.radius : 24;
  const meteorMaxEdge = r / METEOR_RADIUS_FACTOR;
  return meteorMaxEdge * EXPLOSION_SCALE;
}

function drawExplosion(e,frame){
  const spr=images["boom"]; if(!spr) return;
  const fh = spr.height / boomFrameCount;
  const aspect = fh / spr.width;
  const dw = e.size ? e.size : spr.width;
  const dh = dw * aspect;
  ctx.drawImage(spr, 0, fh*frame, spr.width, fh, e.x - dw/2, e.y - dh/2, dw, dh);
}

function drawHUD(){
  drawPixelText(`SCORE ${model.score}`, 20, 12, 16, 'left', '#fff');
  const heart=images['heart']; const scale=4; const size=heart? heart.width*scale : 8*scale; const gap=6;
  let x=20, y=12+22;
  for(let i=0;i<model.lives;i++){
    if(heart) ctx.drawImage(heart, x, y, size, size);
    else drawPixelText('♥', x, y, 16, 'left', '#f55');
    x += size + gap;
  }
}
function drawFooter(){
  const meaningSize = (model.selectedLang === "jp_en") ? 15 : 11;
  drawWrappedText(model.hintMeaningText, UI.hintMeaning.x, UI.hintMeaning.y, UI.hintMeaning.maxW, meaningSize, 'left', '#aee');
  drawWrappedText(model.hintLettersText, UI.hintLetters.x, UI.hintLetters.y, UI.hintLetters.maxW, 15, 'left', '#fff');

  const box = UI.inputBox;
  ctx.save();
  ctx.fillStyle='#0f1d2a'; ctx.fillRect(box.x, box.y, box.w, box.h);
  ctx.strokeStyle = model.inputFocus ? '#5cd4ff' : '#345';
  ctx.lineWidth=2; ctx.strokeRect(box.x+0.5, box.y+0.5, box.w-1, box.h-1);
  const txt = model.input || '';
  drawPixelText(txt, box.x+8, box.y+8, 18, 'left', '#fff');
  ctx.restore();

  drawRectButton(UI.btnBlast.x, UI.btnBlast.y, UI.btnBlast.w, UI.btnBlast.h, 'BLAST', true);
}

// ---- Audio Icon (top-right) ----
const AUDIO_BTN = { x: CANVAS_W - 34, y: 12, w: 24, h: 24 };
function drawAudioIcon(){
  const muted = !!(window.AudioUI && typeof window.AudioUI.isBGMMuted === 'function'
                   ? window.AudioUI.isBGMMuted() : false);
  const cx = AUDIO_BTN.x + AUDIO_BTN.w/2;
  const cy = AUDIO_BTN.y + 2;
  const noteColor = muted ? '#96a3ad' : '#cfe8ff';
  drawPixelText('♬', cx, cy, 16, 'center', noteColor);
  ctx.save();
  ctx.strokeStyle = '#2a3a48';
  ctx.lineWidth = 1;
  ctx.strokeRect(AUDIO_BTN.x + 0.5, AUDIO_BTN.y + 0.5, AUDIO_BTN.w - 1, AUDIO_BTN.h - 1);
  if (muted){
    ctx.strokeStyle = '#ff6b6b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(AUDIO_BTN.x + 3, AUDIO_BTN.y + AUDIO_BTN.h - 3);
    ctx.lineTo(AUDIO_BTN.x + AUDIO_BTN.w - 3, AUDIO_BTN.y + 3);
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Stars & Entities ----
function drawStars(){
  ctx.save();
  for(const s of stars){
    s.phase += s.twinkle;
    const a = 0.4 + 0.6 * (0.5 + 0.5*Math.sin(s.phase));
    ctx.globalAlpha = a;
    ctx.fillStyle = '#cfe8ff';
    ctx.fillRect(s.x, s.y, 2, 2);
  }
  ctx.restore();
}

function spawnMeteor(spawnX, spawnY){
  const x = (typeof spawnX==='number') ? spawnX : Math.random()*CANVAS_W;
  const y = (typeof spawnY==='number') ? spawnY : -50;
  const {bx,by} = baseCenter();
  const T=10.0;
  const vx=(bx-x)/T, vy=(by-y)/T;
  const angle = Math.atan2(vy, vx) - Math.PI/2;
  meteors.push({x,y,vx,vy,radius:meteorRadius(), angle, sx:x, sy:y});
}

function triggerExplosion(x,y,sizePx){
  explosions.push({x,y,size:sizePx,startTime:performance.now()});
}

function blastLastMeteor(){
  if (!meteors.length) return;
  const m = meteors.pop();
  triggerExplosion(m.x, m.y, explosionSizeFromMeteor(m));
  try { sfx.blast.currentTime = 0; sfx.blast.play(); } catch (_) {}
}

// ---- Trail helpers ----
function rand(min,max){ return min + Math.random()*(max-min); }
function emitTrail(m, dt){
  if (!m) return;
  const speed = Math.hypot(m.vx, m.vy);
  const rate  = TRAIL_EMIT_BASE * (1 + TRAIL_SPEED_BIAS * Math.min(speed,300)/300);
  const count = Math.min(8, Math.floor(rate * dt));

  let ux, uy;
  if (typeof m.sx === 'number' && typeof m.sy === 'number') {
    const bx = m.sx - m.x, by = m.sy - m.y;
    const len = Math.hypot(bx, by) || 1; ux = bx / len; uy = by / len;
  } else if (typeof m.angle === 'number') {
    ux = Math.cos(m.angle + Math.PI); uy = Math.sin(m.angle + Math.PI);
  } else {
    const lenV = Math.hypot(m.vx, m.vy) || 1; ux = -m.vx/lenV; uy = -m.vy/lenV;
  }
  const pxv = -uy, pyv = ux;

  for (let i=0;i<count;i++){
    const offBack = rand(m.radius*0.25, m.radius*0.9);
    const side    = rand(-m.radius*0.28, m.radius*0.28);
    const px = m.x + ux*offBack + pxv*side;
    const py = m.y + uy*offBack + pyv*side;

    const along = speed*0.4 + rand(20, 60);
    const vx = ux*along + pxv*rand(-10, 10);
    const vy = uy*along + pyv*rand(-10, 10);

    const life = rand(TRAIL_LIFE_MIN, TRAIL_LIFE_MAX);
    const size = Math.round(rand(TRAIL_SIZE_MIN, TRAIL_SIZE_MAX));
    const col  = TRAIL_COLS[(Math.random()*TRAIL_COLS.length)|0];
    if (trailParticles.length < TRAIL_MAX) {
      trailParticles.push({x:px, y:py, vx, vy, life, max:life, size, col});
    } else {
      trailParticles[(Math.random()*TRAIL_MAX)|0] = {x:px, y:py, vx, vy, life, max:life, size, col};
    }
  }
}
function updateAndDrawTrail(dt){
  ctx.save();
  for (let i=trailParticles.length-1; i>=0; i--){
    const p = trailParticles[i];
    p.life -= dt;
    if (p.life <= 0) { trailParticles.splice(i,1); continue; }
    p.x += p.vx*dt; p.y += p.vy*dt;
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    ctx.fillStyle = p.col;
    const s = p.size;
    const ix = (p.x+0.5)|0, iy = (p.y+0.5)|0;
    ctx.fillRect(ix, iy, s, s);
  }
  ctx.restore();
}

// ---- Title ----
function drawTitle(){
  const titleY = 210;
  drawPixelTextSkew('Lexi',    CANVAS_W/2, titleY,      64, 'center', '#ff9f43', -0.32);
  drawPixelTextSkew('Blaster', CANVAS_W/2, titleY + 60, 56, 'center', '#ffb35a', -0.32);

  const t = Math.floor(performance.now()/500)%2===0;
  if (t) drawPixelText('Click to Start', CANVAS_W/2, titleY + 140, 14, 'center', '#aee');
}

// ---- ループ ----
let lastTime = 0;
function updateAndDraw(ts){
  if(!lastTime) lastTime = ts;
  const dt = (ts-lastTime)/1000;
  lastTime = ts;

  model.baseFlash = Math.max(0, model.baseFlash - dt*2.5);

  ctx.clearRect(0,0,CANVAS_W,CANVAS_H);
  drawBackground(); drawStars(ts);

  const gf = Math.floor(performance.now() / FRAME_DURATION);
  const mf = gf % meteorFrameCount;

  // フェーズ別
  if (model.phase === "countdown") {
    if (model.cdIndex >= 0 && model.cdIndex < model.cdLabels.length) {
      model.cdTimer -= dt;
      if (model.cdTimer <= 0) {
        model.cdIndex += 1; model.cdTimer += 1.0;
        if (model.cdIndex >= model.cdLabels.length) {
          model.phase = "playing";
          model.onStartGame && model.onStartGame();
        }
      }
    }
  }

  if (model.phase === "playing" || model.phase === "gameover") {
    const {bx,by} = baseCenter(); const bR = baseRadius();

    for (let i = meteors.length - 1; i >= 0; i--){
      const m = meteors[i];
      m.x += m.vx * dt; m.y += m.vy * dt;
      const dx = m.x - bx, dy = m.y - by, dist = Math.hypot(dx,dy);
      if (dist <= (m.radius + bR)){
        triggerExplosion(m.x, m.y, explosionSizeFromMeteor(m));
        meteors.splice(i,1);
        window.dispatchEvent(new CustomEvent("meteorHitBase"));
        try{ sfx.blast.currentTime=0; sfx.blast.play(); }catch(_){}
      }
    }

    for (const m of meteors) emitTrail(m, dt);
    updateAndDrawTrail(dt);
    for (const m of meteors) drawMeteor(m, mf);

    // Base
    drawBase();

    for (let i = explosions.length - 1; i >= 0; i--){
      const e = explosions[i];
      const frame = Math.floor((performance.now()-e.startTime)/FRAME_DURATION);
      if (frame >= boomFrameCount) explosions.splice(i,1);
      else drawExplosion(e, frame);
    }
  }

  if (model.phase === "title") {
    drawTitle();
  } else if (model.phase === "selectLevel") {
    drawLevelSelect();
  } else if (model.phase === "selectLang") {
    drawLangSelect();
  } else if (model.phase === "countdown") {
    drawCountdown();
  }

  // フッター/HUDは常時
  drawFooter();
  drawHUD();

  // ♬
  drawAudioIcon();

  // ?（最後に重ねる）
  drawHelp(ctx, canvas);

  requestAnimationFrame(updateAndDraw);
}

// ---- 画面別描画 ----
function drawLevelSelect(){
  drawPixelText('SELECT LEVEL', CANVAS_W/2, 120, 18, 'center', '#5cd4ff');

  const labelRightX = gridX0 - 12;
  rowLabels.forEach((lab, row)=>{
    const y = gridY0 + row*(BTN_H+GAP_Y) + (BTN_H-14)/2;
    drawPixelText(lab, labelRightX, y, 12, 'right', '#aee');
  });

  for(const b of levelGrid){
    const active = (model.selectedLevel === b.key);
    drawRectButton(b.x, b.y, b.w, b.h, b.key, true, active, 16);
  }

  drawPixelText('FILTERS', FILTERS_TITLE_X, FILTERS_TITLE_Y, 12, 'center', '#aee');
  for(const t of toggles){
    const lab = `${t.label} : ${t.on ? "ON" : "OFF"}`;
    drawRectButtonFit(t.x, t.y, t.w, t.h, lab, true, t.on, 12, 10);
  }

  const br = baseRect();
  drawPixelText('Pick a level, then choose a language mode', CANVAS_W/2, br.y + 50, 13, 'center', '#5cd4ff');
}

function drawLangSelect(){
  drawPixelText('SELECT MODE', CANVAS_W/2, 120, 18, 'center', '#5cd4ff');
  drawRectButton(BTN_BACK.x, BTN_BACK.y, BTN_BACK.w, BTN_BACK.h, "BACK", false, false, 12);
  const btns = [
    { label:"EN → EN", x: CANVAS_W/2-240, y: 360, w: 180, h: 56, key:"en_en" },
    { label:"JP → EN", x: CANVAS_W/2-  60, y: 360, w: 180, h: 56, key:"jp_en" },
    // { label:"EN → JP", x: CANVAS_W/2+ 120, y: 360, w: 180, h: 56, key:"en_jp" },
  ];
  btns.forEach(b => drawRectButton(b.x,b.y,b.w,b.h,b.label,true));
}

function drawCountdown(){
  let label = "3";
  if (model.cdIndex >= 0 && model.cdIndex < model.cdLabels.length) label = model.cdLabels[model.cdIndex];
  drawPixelText(label, CANVAS_W/2, PLAYFIELD_H/2 - 30, 48, 'center', '#fff');
}

// ---- 入力/クリック ----
function hitBox(box, mx, my){ return mx>=box.x && mx<=box.x+box.w && my>=box.y && my<=box.y+box.h; }

canvas.addEventListener('mousedown', (e)=>{
  const r = canvas.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;

  // 先に♬
  if (hitBox(AUDIO_BTN, mx, my)) {
    if (window.AudioUI && typeof window.AudioUI.toggleBGM === 'function') window.AudioUI.toggleBGM();
    return;
  }

  if (model.phase === "title") {
    model.phase = "selectLevel";
    return;
  }

  if (model.phase === "selectLevel") {
    for (const b of levelGrid) {
      if (hitBox(b, mx, my)) {
        model.selectedLevel = b.key;
        model.onSelectLevel && model.onSelectLevel(b.key);
        model.phase = "selectLang";
        return;
      }
    }
    for (const t of toggles) {
      if (hitBox(t, mx, my)) {
        t.on = !t.on;
        model.weakOnly = t.on;
        model.onToggleWeak && model.onToggleWeak(t.on);
        return;
      }
    }
  } else if (model.phase === "selectLang") {
    if (hitBox(BTN_BACK, mx, my)) { model.phase = "selectLevel"; return; }
    const btns = [
      { label:"EN → EN", x: CANVAS_W/2-240, y: 360, w: 180, h: 56, key:"en_en" },
      { label:"JP → EN", x: CANVAS_W/2-  60, y: 360, w: 180, h: 56, key:"jp_en" },
      { label:"EN → JP", x: CANVAS_W/2+ 120, y: 360, w: 180, h: 56, key:"en_jp" },
    ];
    for (const b of btns) {
      if (hitBox(b, mx, my)) {
        model.selectedLang = b.key;
        model.onSelectLang && model.onSelectLang(b.key);
        model.phase = "countdown";
        beginCountdown();
        return;
      }
    }
  } else if (model.phase === "playing") {
    if (hitBox(UI.btnBlast, mx, my)) { model.onBlast && model.onBlast(model.input); }
    focusInput(true);
  } else if (model.phase === "gameover") {
    const r1 = { x: CANVAS_W/2-180, y: PLAYFIELD_H/2+60, w:160, h:40 }; // RESTART
    const r2 = { x: CANVAS_W/2+ 20, y: PLAYFIELD_H/2+60, w:160, h:40 }; // TITLE
    if (hitBox(r1, mx, my)) { model.onRestart && model.onRestart(); }
    else if (hitBox(r2, mx, my)) { model.onReturnToTitle && model.onReturnToTitle(); }
  }
});

canvas.addEventListener('mouseup',   ()=>{ if (model.phase==='playing') focusInput(true); });
canvas.addEventListener('pointerup', ()=>{ if (model.phase==='playing') focusInput(true); });

// キー入力
document.addEventListener('keydown', (e)=>{
  const k = e.key;
  if (model.phase === "selectLang" && k === "Escape") { model.phase = "selectLevel"; e.preventDefault(); return; }
  if (model.phase === "gameover") {
    if (k === "r" || k === "R") { model.onRestart && model.onRestart(); e.preventDefault(); return; }
    if (k === "Escape") { model.onReturnToTitle && model.onReturnToTitle(); e.preventDefault(); return; }
  }
  if (model.phase === "playing") {
    if (!model.inputFocus) return;
    if (k === 'Backspace') return;
    if (k === 'Enter')     { model.onBlast && model.onBlast(model.input); return; }
  }
});

// Canvas外クリックで入力OFF（playingのみ）
document.addEventListener('mousedown', (e) => {
  const r = canvas.getBoundingClientRect();
  const inside = (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom);
  if (model.phase === 'playing') { if (!inside) focusInput(false); }
}, { capture:true });

// Spaceスクロール抑止（IME中は許可）
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !isComposing) e.preventDefault();
}, { capture:true });

// ---- Public API ----
async function start(){ await loadAssets(); initStars(); initHelp(canvas); requestAnimationFrame(updateAndDraw); }
function resetScene(){ meteors.length=0; explosions.length=0; trailParticles.length=0; model.input=""; model.hintMeaningText="Hint: —"; model.hintLettersText=""; }
function baseHitFlash(){ model.baseFlash = 0.5; }
async function setMeteorSprite(src){ await loadImage("meteor", src); }
function getInput(){ return model.input; }

window.canvasGame = {
  start,
  // game
  spawnMeteor, triggerExplosion, blastLastMeteor,
  // scene utils
  resetScene, baseHitFlash, setMeteorSprite,
  // ui link
  setHUD, setHints, setInput, focusInput, setFlow, bindCallbacks,
  // getter
  getInput
};
