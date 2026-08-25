// 演出視窗:狙擊 → 走路入場 → 指點 → 對話 → 踢踹 → 爆炸 → 雷歐登場 → 飛離 → 退出
// 行為對齊 Python 原版 main.py(MonsterDeleter 類),畫在透明全屏視窗裡:
// 三個 canvas(背景/怪獸/爆炸)+ 對話氣泡 + 按鈕

const bg = document.getElementById('bg');
const monsterCv = document.getElementById('monster');
const explosionCv = document.getElementById('explosion');
const bubble = document.getElementById('bubble');
const choices = document.getElementById('choices');
const btnYes = document.getElementById('btn-yes');
const btnNo = document.getElementById('btn-no');
const btnSwap = document.getElementById('btn-swap');
const bgm = document.getElementById('bgm');
const sfx = document.getElementById('sfx');
const boom = document.getElementById('boom');
const msg = document.getElementById('msg');

// 音量與原版一致(QMediaPlayer:bgm 0.5 / sfx 1.0 / 爆炸 0.3)
bgm.volume = 0.5;
sfx.volume = 1.0;
boom.volume = 0.3;

const dpr = devicePixelRatio;
function fitCanvas(cv) {
  cv.width = innerWidth * dpr;
  cv.height = innerHeight * dpr;
  cv.style.width = innerWidth + 'px';
  cv.style.height = innerHeight + 'px';
  cv.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
}
[bg, monsterCv, explosionCv].forEach(fitCanvas);

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error('圖片載入失敗: ' + src));
    img.src = src;
  });
}
function playAudio(el, p) {
  if (!p) return;
  const url = window.api.toFileUrl(p);
  if (el.src !== url) el.src = url;   // 同源則續播(換角時 BGM 不打斷,同原版 _apply_audio)
  el.play().catch(() => {});
}

// ---------- SpriteAnimator(canvas 逐幀動畫,對應 Qt 的 SpriteAnimator) ----------
class SpriteAnimator {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.frames = [];
    this.i = 0;
    this.loop = true;
    this.flip = false;
    this.tint = null;
    this.timer = null;
    this.onFrame = null;   // 關鍵幀回撥(Qt 的 frameChanged 訊號)
    this.onEnd = null;
    this.x = 0; this.y = 0;   // 精靈繪製位置(像素)
    this.scale = 1;
  }
  get w() { return this.frames[0] ? this.frames[0].width * this.scale : 0; }
  get h() { return this.frames[0] ? this.frames[0].height * this.scale : 0; }
  async loadSpritesheet(url, cols = 5, rows = 3, frameIndices = null, targetHeight = 250) {
    const img = await loadImage(url);
    const fw = img.naturalWidth / cols, fh = img.naturalHeight / rows;
    this.frames = [];
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const off = document.createElement('canvas');
      off.width = fw; off.height = fh;
      off.getContext('2d').drawImage(img, c * fw, r * fh, fw, fh, 0, 0, fw, fh);
      this.frames.push(off);
    }
    if (frameIndices) this.frames = frameIndices.map((i) => this.frames[i]).filter(Boolean);
    this.scale = targetHeight / this.frames[0].height;
    this.i = 0;
  }
  play(fps = 8, loop = true) {
    this.loop = loop; this.i = 0; this.draw();
    clearInterval(this.timer);
    this.timer = setInterval(() => this.next(), 1000 / fps);
  }
  next() {
    this.i++;
    if (this.i >= this.frames.length) {
      if (this.loop) { this.i = 0; }
      else {
        this.i = this.frames.length - 1;
        clearInterval(this.timer);
        this.onEnd?.();
        return;
      }
    }
    this.draw();
    this.onFrame?.(this.i);
  }
  draw() {
    const f = this.frames[this.i];
    if (!f) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.translate(this.x, this.y);
    ctx.scale(this.flip ? -1 : 1, 1);
    ctx.drawImage(f, this.flip ? -this.w : 0, 0, this.w, this.h);
    if (this.tint) {   // 染色變體:source-atop 疊加(對應 QGraphicsColorizeEffect)
      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = this.tint.strength;
      ctx.fillStyle = this.tint.color;
      ctx.fillRect(this.flip ? -this.w : 0, 0, this.w, this.h);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    ctx.restore();
  }
  setTint(color, strength) {
    this.tint = strength > 0.01 ? { color, strength } : null;
    this.draw();
  }
}

// ---------- 緩動移動(QPropertyAnimation + QEasingCurve) ----------
const EASING = {
  'out-quad': (t) => 1 - (1 - t) ** 2,   // OutQuad
  'in-quad': (t) => t * t,               // InQuad
};
function animateTo(anim, x0, y0, x1, y1, ms, easing, done) {
  const t0 = performance.now();
  (function tick(now) {
    const t = Math.min(1, (now - t0) / ms);
    const e = EASING[easing](t);
    anim.x = x0 + (x1 - x0) * e;
    anim.y = y0 + (y1 - y0) * e;
    anim.draw();
    if (t < 1) requestAnimationFrame(tick); else done?.();
  })(t0);
}

// ---------- 瞄準遮罩(對應參考專案 paint_background + paintEvent) ----------
const bgCtx = bg.getContext('2d');
let bgAlpha = 0;            // 當前淡入進度(0 → bgOpacity)
let bgOpacity = 0.35;       // 背景圖目標不透明度,來自角色 config 的 targeting.bg_opacity
let bgImg = null;           // 本角色 targeting_bg.png(缺失退化為黑色遮罩)

async function loadBgImage() {
  if (!char || !char.targetBg || bgImg) return;
  try { bgImg = await loadImage(window.api.toFileUrl(char.targetBg)); } catch { bgImg = null; }
  if (bgAlpha > 0.01) drawBg();   // 淡入過程中載入完,補畫一幀
}

// 背景圖按【原本尺寸】居中繪製(不拉伸鋪滿),透明度跟隨淡入到 bgOpacity;
// 圖片缺失時退化為黑色遮罩(參考專案 QColor(0,0,0,160) × opacity)
function drawBg() {
  bgCtx.clearRect(0, 0, bg.width, bg.height);
  if (bgAlpha <= 0.01) return;
  if (bgImg) {
    bgCtx.globalAlpha = bgAlpha;   // 0 → bgOpacity(config 可調,預設 0.35)
    const w = bgImg.naturalWidth, h = bgImg.naturalHeight;   // 原圖尺寸,不縮放
    bgCtx.drawImage(bgImg, (bg.width - w) / 2, (bg.height - h) / 2, w, h);
    bgCtx.globalAlpha = 1;
  } else {
    bgCtx.fillStyle = `rgba(0, 0, 0, ${0.627 * bgAlpha})`;
    bgCtx.fillRect(0, 0, bg.width, bg.height);
  }
  // 白色加粗提示文字居中,透明度隨遮罩(參考專案 30pt bold ≈ 40px)
  if (char) {
    bgCtx.globalAlpha = Math.min(1, bgAlpha / bgOpacity);
    bgCtx.fillStyle = '#ffffff';
    bgCtx.font = "bold 40px 'Segoe UI', 'Microsoft YaHei', sans-serif";
    bgCtx.textAlign = 'center';
    bgCtx.textBaseline = 'middle';
    bgCtx.fillText(char.texts.targeting, bg.width / 2, bg.height / 2);
    bgCtx.globalAlpha = 1;
  }
}
function fadeBg(to, ms, done) {
  const t0 = performance.now();
  const from = bgAlpha;
  (function tick(now) {
    const t = Math.min(1, (now - t0) / ms);
    bgAlpha = from + (to - from) * (1 - (1 - t) ** 2);
    drawBg();
    if (t < 1) requestAnimationFrame(tick); else done?.();
  })(t0);
}

// ---------- 全域性狀態 ----------
let targetPos = null;
let char = null;
let targetFile = null;
let chars = [];
let showStarted = false;   // 開演後忽略遲到的定位/點選,防止重複開演
let manualMode = false;    // 本次召喚是否走手動瞄準(開關開啟 且 目標是桌面檔案)

const monsterAnim = new SpriteAnimator(monsterCv);
const explosionAnim = new SpriteAnimator(explosionCv);

// ---------- 入口:主程序發來目標檔案 ----------
window.api.onInitShow(async (d) => {
  targetFile = d.targetFile;
  chars = await window.api.scanCharacters();
  if (!chars.length) {
    msg.style.display = 'block';
    return;
  }
  const last = await window.api.getLastCharacter();
  char = chars.find((c) => c.id === last) || chars[0];
  const op = char.targeting && char.targeting.bg_opacity != null ? Number(char.targeting.bg_opacity) : 0.35;
  bgOpacity = Math.min(1, Math.max(0, op));   // 瞄準背景圖不透明度(config 可調,預設 0.35)
  loadBgImage();   // 預載入瞄準背景圖(手動兜底時用,與定位並行)

  // 手動定位開關只對桌面目標生效:桌面檔案 → 直接出十字準星手動點選;
  // 資料夾裡的檔案 → 照常自動定位(不受開關影響)。
  if (await window.api.getManualTargeting() && d.onDesktop) {
    manualMode = true;
    initTargeting(char);
    return;
  }

  if (d.targetPos) { startShowNow(d.targetPos); return; }
  if (pendingTarget) { startShowNow(pendingTarget); return; }
  if (d.failed) initTargeting(char);   // 定位失敗 → 手動瞄準兜底(十字準星 + 點選)
  // 否則:主程序還在定位(視窗保持透明,定位完成直接開演,無需提示)
});

// 主程序定位到檔案圖示後發來精確座標(可能早於 init-show 到達,先存著)
let pendingTarget = null;
window.api.onAutoTarget((pos) => {
  if (showStarted || manualMode) return;
  if (!char) { pendingTarget = pos; return; }
  startShowNow(pos);
});

// 定位徹底失敗:切手動瞄準,讓使用者自己點(不瞎猜游標位置)
window.api.onAutoTargetFailed(() => {
  if (showStarted || manualMode) return;
  if (char) initTargeting(char);
});

// 自動瞄準開演:直接開演(怪獸從螢幕外走進來本身就是入場)
function startShowNow(pos) {
  if (showStarted) return;
  showStarted = true;
  targetPos = pos;
  document.body.style.cursor = 'default';
  bubble.style.display = 'none';
  startShow();
}

// ---------- 狙擊瞄準(對應 init_targeting_ui + paintEvent;僅定位失敗兜底用) ----------
function initTargeting(c) {
  document.body.style.cursor = `url('data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><circle cx="20" cy="20" r="12" fill="none" stroke="red" stroke-width="2"/><path d="M20 0v8M20 32v8M0 20h8M32 20h8" stroke="red" stroke-width="2"/></svg>`
  )}') 20 20, crosshair`;
  fadeBg(bgOpacity, 800);   // 原版 fade_in:800ms → 配置的不透明度(預設 0.35)

  window.addEventListener('click', (e) => {   // 原版 mousePressEvent(左鍵)
    if (showStarted) return;
    showStarted = true;
    targetPos = { x: e.clientX, y: e.clientY };
    document.body.style.cursor = 'default';
    fadeBg(0, 500, startShow);   // 原版 fade_out:500ms
  }, { once: true });
}

// ---------- 演出狀態機(對應 start_phase1_walk → phase5) ----------
async function startShow() {
  const m = monsterAnim;
  m.onFrame = null;
  m.onEnd = null;
  playAudio(bgm, char.paths.audio.bgm);   // 原版:phase1 開始播 BGM(此時已有點選手勢)

  const h = char.animation.sprite_height;
  const y = targetPos.y - h / 2 + char.animation.walk_y_offset;

  m.setTint(char.tint.color, char.tint.strength);
  await m.loadSpritesheet(window.api.toFileUrl(char.paths.sprites.walk), 5, 3, null, h);
  // 目標太靠左時從右邊進場:預設終點在目標左邊(怪獸面向右指向檔案),
  // 若目標貼著螢幕左緣,終點會變成負座標,怪獸整只走到螢幕外(卡在左邊)。
  // 此時映象翻面、從右側進場,終點在目標右邊,臉朝左指著檔案。
  const gap = char.animation.target_gap;
  const fromRight = targetPos.x - m.w - gap < 0;
  const startX = fromRight ? innerWidth + m.w : -m.w;       // 原版 start_x = -width:整寬在螢幕外
  const endX = fromRight ? targetPos.x + gap : targetPos.x - m.w - gap;
  m.flip = fromRight;
  m.x = startX; m.y = y;
  m.play(char.animation.fps, true);         // 邊走邊播走路動畫(原版 play + move 並行)
  animateTo(m, startX, y, endX, y, char.animation.walk_duration_ms, 'out-quad', async () => {
    playAudio(sfx, char.paths.audio.voice);   // 原版:指點動畫開始播 SFX
    await m.loadSpritesheet(window.api.toFileUrl(char.paths.sprites.point), 5, 3, char.sprites.point_frames, h);
    m.play(char.animation.fps, false);
    m.onEnd = showDialog;
  });
}

function showDialog() {   // 原版 show_dialog:氣泡在怪獸中心上方,按鈕在正下方
  const m = monsterAnim;
  bubble.textContent = char.texts.dialog;
  bubble.style.transform = 'none';
  bubble.style.left = `${m.x + m.w / 2 - 80}px`;
  bubble.style.top = `${m.y - 60}px`;
  bubble.style.display = 'block';

  btnYes.textContent = char.texts.choice_yes;
  btnNo.textContent = char.texts.choice_no;
  btnSwap.textContent = char.texts.swap;
  choices.style.left = `${m.x + m.w / 2 - 130}px`;
  choices.style.top = `${m.y + m.h - 20}px`;
  choices.style.display = 'flex';

  btnYes.onclick = btnNo.onclick = () => {
    choices.style.display = 'none';
    bubble.style.display = 'none';
    startKick();   // 原版 choiceMade → start_phase3_kick
  };
  btnSwap.onclick = () => {
    choices.style.display = 'none';
    bubble.style.display = 'none';
    window.api.swapCharacter();   // 主程序開啟角色視窗(換角模式)
  };
}

async function startKick() {
  const m = monsterAnim;
  await m.loadSpritesheet(window.api.toFileUrl(char.paths.sprites.kick), 5, 3, null, char.animation.sprite_height);
  m.onFrame = (i) => { if (i === char.animation.kick_frame) triggerExplosion(); };   // 原版:第 6 幀爆炸
  m.onEnd = async () => {
    m.onFrame = null;   // 原版 on_kick_finished 裡 disconnect 兩個訊號
    await m.loadSpritesheet(window.api.toFileUrl(char.paths.sprites.leo), 5, 3, null, char.animation.sprite_height);
    m.play(char.animation.fps, false);
    m.onEnd = async () => {
      await m.loadSpritesheet(window.api.toFileUrl(char.paths.sprites.fly), 5, 3, null, char.animation.sprite_height);
      m.play(char.animation.fps, true);
      animateTo(m, m.x, m.y, innerWidth + 200, m.y, char.animation.fly_duration_ms, 'in-quad', () => window.api.closeApp());
    };
  };
  m.play(char.animation.fps, false);
}

function triggerExplosion() {   // 對應原版 trigger_explosion
  playAudio(boom, char.paths.audio.explosion);
  const ex = explosionAnim;
  ex.setTint(char.tint.color, char.tint.strength);
  if (!char.paths.sprites.explosion) return;
  ex.loadSpritesheet(window.api.toFileUrl(char.paths.sprites.explosion), 5, 3, null, char.animation.explosion_height)
    .then(() => {
      ex.x = targetPos.x - ex.w / 2;
      ex.y = targetPos.y - ex.h / 2 - char.animation.explosion_y_offset;   // 原版:略高於檔案圖示
      ex.onEnd = () => ex.ctx.clearRect(0, 0, ex.canvas.width, ex.canvas.height);   // 播完隱藏
      ex.play(char.animation.fps, false);
    })
    .catch(() => {});
  window.api.trashFile(targetFile).then((r) => {   // 同步爆炸時機,同原版
    if (!r || !r.ok) console.warn('回收站刪除失敗:', r && r.reason);
  });
}

// 換角:主程序通知 → 換角色 → 重新演出(原版 on_character_selected → start_phase1_walk)
window.api.onSwapDone(async (charId) => {
  const next = chars.find((c) => c.id === charId);
  if (!next) return;
  char = next;
  startShow();
});

// Esc 退出(對應 keyPressEvent → on_app_exit)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.api.closeApp();
});
