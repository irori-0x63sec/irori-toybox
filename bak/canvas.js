// canvas.js  — meteors move toward Base and arrive exactly in 10s

const canvas = document.getElementById("gameCanvas");
const ctx     = canvas.getContext("2d");

// === Animation (sprite) timing ===
const FPS = 3;                         // animation fps (for sprite frame stepping)
const FRAME_DURATION = 1000 / FPS;

const images = {};
const meteors = [];  // { x,y, vx,vy, spawnTime, radius }
const explosions = [];// { x,y, startTime }

let baseFrameCount   = 3;
let meteorFrameCount = 3;
let boomFrameCount   = 4;

let lastTime = 0;

// ------------ Asset Loading ------------
function loadImage(key, src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => { images[key] = img; resolve(); };
    img.src = src;
  });
}

async function loadAssets() {
  await loadImage("meteor", "assets/meteor.png");
  await loadImage("base",   "assets/base.png");
  await loadImage("boom",   "assets/boom.png");
  await loadImage("back",   "assets/back.png");
}

// ------------ Helpers ------------
function baseSpriteWH() {
  const base = images["base"];
  if (!base) return { w: 0, h: 0 };
  // 縦にフレームが並ぶスプライト
  return { w: base.width, h: base.height / baseFrameCount };
}

function meteorSpriteWH() {
  const spr = images["meteor"];
  if (!spr) return { w: 0, h: 0 };
  return { w: spr.width, h: spr.height / meteorFrameCount };
}

function baseRect() {
  const { w, h } = baseSpriteWH();
  const x = (canvas.width - w) / 2;
  const y = canvas.height - h;
  return { x, y, w, h };
}

function baseCenter() {
  const r = baseRect();
  return { bx: r.x + r.w / 2, by: r.y + r.h / 2 };
}

function meteorRadius() {
  const { w, h } = meteorSpriteWH();
  // おおまかに半径（円）として使う。見た目優先で 0.45 程度が良い
  return Math.max(w, h) * 0.45;
}

function baseRadius() {
  // Baseの当たり判定は「画像サイズそのまま」でOKとのことだが
  // 円判定用に近似して半径を算出（幅/高さの大きい方ベース）
  const { w, h } = baseSpriteWH();
  return Math.max(w, h) * 0.5;
}

// ------------ Drawing ------------
function drawBackground() {
  const back = images["back"];
  if (!back) return;
  ctx.drawImage(back, 0, 0, canvas.width, canvas.height);
}

function drawBase(frame) {
  const base = images["base"];
  if (!base) return;
  const { w, h } = baseSpriteWH();
  const { x, y } = baseRect();
  ctx.drawImage(base, 0, h * frame, w, h, x, y, w, h);
}

function drawMeteor(m, frame) {
  const spr = images["meteor"];
  if (!spr) return;
  const { w, h } = meteorSpriteWH();
  // 回転は今回は不要（ユーザ指定）なのでそのまま
  ctx.drawImage(spr, 0, h * frame, w, h, m.x - w/2, m.y - h/2, w, h);
}

function drawExplosion(exp, frame) {
  const spr = images["boom"];
  if (!spr) return;
  const w = spr.width;
  const h = spr.height / boomFrameCount;
  ctx.drawImage(spr, 0, h * frame, w, h, exp.x - w/2, exp.y - h/2, w, h);
}

// ------------ Main Loop ------------
function updateAndDraw(ts) {
  if (!lastTime) lastTime = ts;
  const dtMs  = ts - lastTime;
  const dtSec = dtMs / 1000;
  lastTime = ts;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // レイヤ順：Back → Meteors → Base → Explosions（爆発は最前面）
  drawBackground();

  // アニメフレーム
  const globalFrame  = Math.floor(performance.now() / FRAME_DURATION);
  const meteorFrame  = globalFrame % meteorFrameCount;
  const baseFrame    = globalFrame % baseFrameCount;

  // === Meteors update ===
  const { bx, by } = baseCenter();
  const bR = baseRadius();

  for (let i = meteors.length - 1; i >= 0; i--) {
    const m = meteors[i];
    // 位置更新
    m.x += m.vx * dtSec;
    m.y += m.vy * dtSec;

    // 命中判定（円×円）
    const dx = m.x - bx;
    const dy = m.y - by;
    const dist = Math.hypot(dx, dy);
    if (dist <= (m.radius + bR)) {
      // 命中 → 爆発生成 → meteor削除 → イベント通知
      triggerExplosion(m.x, m.y);
      meteors.splice(i, 1);
      window.dispatchEvent(new CustomEvent("meteorHitBase"));
      continue;
    }

    drawMeteor(m, meteorFrame);
  }

  drawBase(baseFrame);

  // === Explosions ===
  for (let i = explosions.length - 1; i >= 0; i--) {
    const exp = explosions[i];
    const elapsed = performance.now() - exp.startTime;
    const frame = Math.floor(elapsed / FRAME_DURATION);
    if (frame >= boomFrameCount) explosions.splice(i, 1);
    else drawExplosion(exp, frame);
  }

  requestAnimationFrame(updateAndDraw);
}

// ------------ Spawning / Effects ------------
function spawnMeteor(spawnX, spawnY) {
  // デフォルトは画面上部のランダム（やや外側から来てもOK）
  const x = (typeof spawnX === "number") ? spawnX : Math.random() * canvas.width;
  const y = (typeof spawnY === "number") ? spawnY : -50;

  const { bx, by } = baseCenter();

  // 目標(Base中心)に「ちょうど10秒」で到達する速度ベクトルを作る（px/sec）
  const T = 10.0; // seconds to hit
  const dx = bx - x;
  const dy = by - y;
  const vx = dx / T;
  const vy = dy / T;

  meteors.push({
    x, y,
    vx, vy,                 // px/sec
    spawnTime: performance.now(),
    radius: meteorRadius()
  });
}

function triggerExplosion(x, y) {
  explosions.push({ x, y, startTime: performance.now() });
}

function blastLastMeteor() {
  if (meteors.length === 0) return;
  const m = meteors.pop();
  triggerExplosion(m.x, m.y);
}

// ------------ Public API ------------
window.canvasGame = {
  start: async () => {
    await loadAssets();
    requestAnimationFrame(updateAndDraw);
  },
  spawnMeteor,
  triggerExplosion,
  blastLastMeteor
};

// デバッグ用：ロード確認
console.log("canvas.js loaded");
