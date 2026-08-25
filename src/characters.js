// 角色系統(port of characters.py)
// - 掃描 assets 下的角色資料夾(有走路 spritesheet 或 config.json 才算)
// - 預設配置深合併 + 素材回退鏈(folder → baseDir → assetsRoot)
// - settings.json:exe 同目錄 → %APPDATA% 回退
// 只在主程序執行;app 引用做了容錯,純 Node 也能單測
const fs = require('fs');
const path = require('path');
const os = require('os');

let app = null;
try { app = require('electron').app; } catch { /* 純 Node 環境下載入 */ }

const DEFAULT_CHARACTER = {
  id: 'niulai',
  name: '牛來',
  description: '手搓五年的小牛犢，一腳踹飛你的檔案',
  sprites: {
    walk: '走路动效_spritesheet.png',
    point: '指着文件_spritesheet.png',
    kick: '踹文件动效_spritesheet.png',
    explosion: '爆炸_spritesheet.png',
    leo: '雷欧登场_spritesheet.png',
    fly: '出场飞行动效_spritesheet.png',
    point_frames: [11, 12, 13, 14],
  },
  audio: {
    bgm: 'audio/bgm(1).mp3',
    voice: 'audio/怪兽说话.mp3',
    explosion: 'audio/爆炸.MP4',
  },
  texts: {
    targeting: '指一個要摧毀的檔案，牛來了',
    dialog: '媽媽——是這個嗎？',
    choice_yes: '就是它',
    choice_no: '不是，我再挑一個',
    swap: '換一隻',
  },
  animation: {
    fps: 8,                    // 動畫幀率
    sprite_height: 250,        // 角色顯示高度(像素)
    walk_duration_ms: 4500,    // 走路入場時長(毫秒)
    explosion_height: 150,     // 爆炸圖顯示高度(像素)
    walk_y_offset: 50,         // 走路時角色相對目標點的垂直偏移(像素,正=偏下)
    target_gap: 30,            // 角色前蹄與目標檔案的水平間距(像素)
    kick_frame: 5,             // 踢踹動畫第幾幀觸發爆炸(0 起,預設第 6 幀)
    fly_duration_ms: 2000,     // 飛離動畫時長(毫秒)
    explosion_y_offset: 40,    // 爆炸圖相對目標點上移量(像素)
  },
  tint: { color: '#ffffff', strength: 0 },
  targeting: { bg_opacity: 0.35 },   // 瞄準介面背景圖(targeting_bg.png)的不透明度,0~1
};
const MERGE_SECTIONS = ['sprites', 'audio', 'texts', 'animation', 'tint', 'targeting'];
const WALK_PATTERNS = ['走路动效_spritesheet', 'walk_spritesheet'];

// 支援註釋的 JSON(JSONC):剝掉 // 行註釋和 /* */ 塊註釋,字串裡的保留
function stripJsonComments(text) {
  let out = '';
  let inStr = false, esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      out += ch;
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; out += ch; continue; }
    if (ch === '/' && text[i + 1] === '/') {          // 行註釋
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';                                    // 保留換行,報錯行號不亂
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {          // 塊註釋
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;                                            // 跳過 */
      continue;
    }
    out += ch;
  }
  return out;
}

function deepMerge(base, override) {
  const out = { ...base };
  for (const [k, v] of Object.entries(override || {})) {
    if (MERGE_SECTIONS.includes(k) && typeof v === 'object' && v !== null && typeof base[k] === 'object') {
      out[k] = deepMerge(base[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function hasWalkSprite(folder) {
  try {
    return fs.readdirSync(folder).some((f) => {
      const low = f.toLowerCase();
      return low.endsWith('.png') && WALK_PATTERNS.some((p) => low.startsWith(p));
    });
  } catch { return false; }
}

// 配置檔案支援兩種副檔名:.jsonc(帶註釋,編輯器友好)優先,.json(嚴格 JSON)兜底
function hasConfig(folder) {
  return ['config.jsonc', 'config.json'].some((n) => fs.existsSync(path.join(folder, n)));
}

function findAsset(dirs, name) {
  if (!name) return null;
  for (const dir of dirs) {
    if (!dir) continue;
    const cand = path.join(dir, name);
    if (name.toLowerCase().endsWith('.png')) {
      const t = cand.replace(/\.png$/i, '_transparent.png');   // 優先透明版
      if (fs.existsSync(t)) return t;
    }
    if (fs.existsSync(cand)) return cand;
  }
  return null;
}

function scanCharacters(assetsRoot) {
  let folders = [];
  try {
    folders = fs.readdirSync(assetsRoot)
      .map((e) => path.join(assetsRoot, e))
      .filter((f) => { try { return fs.statSync(f).isDirectory(); } catch { return false; } })
      .filter((f) => hasWalkSprite(f) || hasConfig(f))
      .sort();
  } catch (e) { console.error('assets scan failed', e); return []; }
  const baseDir = folders.find(hasWalkSprite) || null;

  return folders.map((folder) => {
    let config = {};
    const cfgPath = ['config.jsonc', 'config.json']
      .map((n) => path.join(folder, n))
      .find((p) => fs.existsSync(p));
    if (cfgPath) {
      try { config = JSON.parse(stripJsonComments(fs.readFileSync(cfgPath, 'utf-8'))); }
      catch (e) { console.error('config error', cfgPath, e); }
    }
    const m = deepMerge(DEFAULT_CHARACTER, config);
    const fallbacks = [folder, baseDir, assetsRoot];
    return {
      id: m.id || path.basename(folder),
      folder,
      name: m.name || path.basename(folder),
      description: m.description || `來自 "${path.basename(folder)}" 資料夾的怪獸`,
      sprites: m.sprites, audio: m.audio, texts: m.texts,
      animation: m.animation, tint: m.tint, targeting: m.targeting,
      spritePath: (key) =>
        findAsset(fallbacks, m.sprites[key]) ||
        findAsset(fallbacks, DEFAULT_CHARACTER.sprites[key]),
      audioPath: (key) => findAsset([folder, assetsRoot], m.audio[key]),
    };
  });
}

// ---------- settings.json:exe 同目錄 → %APPDATA% 回退 ----------
function settingsDir() {
  let candidate;
  if (app && app.isPackaged) {
    // 使用者資料目錄:安裝目錄會被覆蓋安裝/解除安裝清掉,設定放這裡才不丟
    candidate = app.getPath('userData');
  } else if (app) {
    candidate = app.getAppPath();                 // dev:專案根目錄
  } else {
    candidate = process.cwd();
  }
  try {
    fs.accessSync(candidate, fs.constants.W_OK);
    return candidate;
  } catch {
    const fb = path.join(process.env.APPDATA || os.homedir(), 'NiuLaiDeleter');
    fs.mkdirSync(fb, { recursive: true });
    return fb;
  }
}
function settingsPath() { return path.join(settingsDir(), 'settings.json'); }

function saveLastCharacter(id) {
  try {
    const data = fs.existsSync(settingsPath())
      ? JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) : {};
    data.last_character = id;
    fs.writeFileSync(settingsPath(), JSON.stringify(data, null, 2), 'utf-8');
  } catch (e) { console.error('save settings', e); }
}
function loadLastCharacter() {
  try {
    if (fs.existsSync(settingsPath())) {
      return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')).last_character || null;
    }
  } catch (e) { console.error('load settings', e); }
  return null;
}

// ---------- 通用設定讀寫(與 last_character 共用 settings.json) ----------
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath())) {
      return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8')) || {};
    }
  } catch (e) { console.error('load settings', e); }
  return {};
}
function saveSettings(patch) {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify({ ...loadSettings(), ...patch }, null, 2), 'utf-8');
  } catch (e) { console.error('save settings', e); }
}

// 桌面手動定位開關:桌面自動定位受解析度/縮放/編碼/桌面整理軟體影響,
// 可能不準,使用者可在主視窗勾選後強制改為十字準星手動點選瞄準
function loadManualTargeting() { return !!loadSettings().manual_targeting; }
function saveManualTargeting(v) { saveSettings({ manual_targeting: !!v }); }

module.exports = { scanCharacters, saveLastCharacter, loadLastCharacter, loadManualTargeting, saveManualTargeting };
