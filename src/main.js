// 牛來摧毀檔案 - 主程序
// 職責:生命週期 / 右鍵選單註冊 / 啟動模式判斷 / 視窗建立 / IPC / 回收站刪除
const { app, BrowserWindow, ipcMain, shell, screen, Menu, dialog } = require('electron');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const characters = require('./characters');

// 必須在 ready 之前設定
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');  // 防音訊被攔
app.setAppUserModelId('com.example.monsterdeleter');                          // 工作列圖示

// 去掉視窗自帶的 File/Edit/View/Window 預設選單欄
Menu.setApplicationMenu(null);

// 兩個註冊位置:* = 所有檔案;Directory = 資料夾(原版只支援檔案,這裡補上資料夾)
const MENU_KEYS = [
  'HKCU\\Software\\Classes\\*\\shell\\SummonNiuLai',
  'HKCU\\Software\\Classes\\Directory\\shell\\SummonNiuLai',
];

// ---------- 右鍵選單註冊(只在打包後執行) ----------
// 結構要和原版一致:
//   ...\shell\SummonNiuLai           預設值=選單顯示名,Icon=圖示
//   ...\shell\SummonNiuLai\command   預設值="{exe}" "%1"
// portable 目標下 process.execPath 指向臨時解壓目錄,必須用 PORTABLE_EXECUTABLE_FILE
// 先刪後寫:清掉舊版本(含 Python 版)留下的孤兒子鍵,保證每次都是乾淨註冊
// 選單顯示名跟隨當前預設角色(使用者換角色後同步更新)
function contextMenuLabel() {
  const lastId = characters.loadLastCharacter();
  if (lastId) {
    const cur = characters.scanCharacters(assetsDir()).find((c) => c.id === lastId);
    if (cur) return `召喚${cur.name}摧毀`;
  }
  return '召喚牛來摧毀';
}
function registerContextMenu() {
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const cmd = `"${exe}" "%1"`;
  const reg = (args) => execFile('reg', ['add', ...args], () => {});
  for (const key of MENU_KEYS) {
    execFile('reg', ['delete', key, '/f'], () => {
      reg([key, '/ve', '/d', contextMenuLabel(), '/f']);
      reg([key, '/v', 'Icon', '/d', `"${exe}",0`, '/f']);
      reg([`${key}\\command`, '/ve', '/d', cmd, '/f']);
    });
  }
}

// ---------- 啟動模式 ----------
// 從 argv 裡找被召喚的目標:必須是存在的【檔案或資料夾】(排除 exe 自身、命令列開關)
const SELF = [process.execPath, process.env.PORTABLE_EXECUTABLE_FILE].filter(Boolean);
function findTargetFile(argv) {
  return argv.find((a) => {
    if (!a || a.startsWith('-') || SELF.includes(a)) return false;
    try {
      const st = fs.statSync(a);
      return st.isFile() || st.isDirectory();
    } catch { return false; }
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (e, argv) => {
    const file = findTargetFile(argv);
    if (!file) return;
    if (app.isReady()) openShowWindow(file);
    else app.whenReady().then(() => openShowWindow(file));
  });
  app.whenReady().then(() => {
    ensureUserAssets();                           // 首啟把內建素材複製到使用者目錄
    if (app.isPackaged) registerContextMenu();  // dev 模式註冊沒意義
    const file = findTargetFile(process.argv);
    if (file) openShowWindow(file);   // 右鍵召喚:帶檔案參數
    else openCharacterWindow();       // 雙擊 exe:角色選擇視窗
  });
}

app.on('window-all-closed', () => {
  // 換角模式:角色視窗關了但演出視窗還活著,不能退
  if (!showWin || showWin.isDestroyed()) app.quit();
});

// ---------- 角色選擇視窗 ----------
function openCharacterWindow(swapMode = false) {
  const win = new BrowserWindow({
    width: 1020, height: 660,
    minWidth: 920, minHeight: 560,
    title: '召喚牛來摧毀檔案',
    alwaysOnTop: swapMode,            // 演出中換角要置頂
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, 'renderer', 'character.html'), { query: { swap: swapMode ? '1' : '0' } });
}

// ---------- 演出視窗(透明全屏,唯一一個) ----------
let showWin = null;

// 精確鎖定檔案圖示在螢幕上的位置:列舉資源管理器/桌面的列表檢視按檔名匹配。
// 右鍵選單點選時游標已偏移到選單項上,不能用游標當目標。
// 預編譯 C# 工具(find-file-rect.exe,~10ms 啟動),比 PowerShell 冷啟動快 ~1s
function findFilePosition(file) {
  return new Promise((resolve) => {
    const tool = app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'build', 'find-file-rect.exe')
      : path.join(app.getAppPath(), 'build', 'find-file-rect.exe');
    execFile(tool, [file], { timeout: 8000 }, (err, stdout, stderr) => {
      const m = !err ? stdout.trim().match(/^(-?\d+)\s+(-?\d+)$/) : null;
      logFind(tool, file, err ? err.code : null, stdout, stderr, m ? 'found' : 'no-match');
      // 工具保證輸出物理像素(內部按 dpi 模式 + UIA 座標空間自校準,見 find-file-rect.cs),
      // 這裡不再做任何座標空間猜測。
      resolve(m ? { x: parseInt(m[1], 10), y: parseInt(m[2], 10) } : null);
    });
  });
}
// 每次召喚都寫一行診斷日誌(%APPDATA%\niulai-deleter\find-file-rect.log),
// 含工具的 DPI 感知模式/命中通道/座標/退出碼——遠端使用者報"瞄不準"時靠它定位。
// 日誌上限 500KB,超出刪掉重寫,避免無限膨脹。
function logFind(tool, file, exitCode, stdout, stderr, status) {
  try {
    const log = path.join(app.getPath('userData'), 'find-file-rect.log');
    try { if (fs.statSync(log).size > 500 * 1024) fs.unlinkSync(log); } catch {}
    const line = `[${new Date().toISOString()}] status=${status} exit=${exitCode ?? 'n/a'} file=${file}\n` +
      `  stdout=${JSON.stringify((stdout || '').slice(0, 200))}\n` +
      `  stderr=${JSON.stringify((stderr || '').slice(0, 600))}\n`;
    fs.appendFileSync(log, line);
  } catch (e) { console.error('write find log', e); }
}

// 目標是否在桌面上(使用者桌面含 OneDrive 重定向 + 公共桌面)。
// 主視窗的"桌面手動定位"開關只對桌面目標生效,資料夾裡的檔案不受影響。
function isDesktopTarget(file) {
  try {
    const dir = path.dirname(file).toLowerCase().replace(/\\$/, '');
    const candidates = [app.getPath('desktop')];
    if (process.env.PUBLIC) candidates.push(path.join(process.env.PUBLIC, 'Desktop'));
    return candidates.some((c) => dir === c.toLowerCase().replace(/\\$/, ''));
  } catch { return false; }
}

function openShowWindow(targetFile) {
  if (showWin && !showWin.isDestroyed()) showWin.close();   // 重複召喚時換新
  // 演出視窗開到游標所在的那塊屏(右鍵選單就在那)
  const cp = screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(cp);
  const { bounds } = display;
  let pendingPos = null;    // 工具結果早於頁面載入完成時暫存
  let pendingFail = false;  // 工具失敗但頁面未載入完,載入完後通知渲染端
  showWin = new BrowserWindow({
    x: bounds.x, y: bounds.y,
    width: bounds.width, height: bounds.height,
    frame: false, transparent: true, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false, resizable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  showWin.setAlwaysOnTop(true, 'screen-saver');   // 壓過全屏應用
  showWin.loadFile(path.join(__dirname, 'renderer', 'show.html'));
  showWin.webContents.once('did-finish-load', () => {
    // 定位若已完成則直接帶上,否則渲染端先顯示"定位中"
    showWin.webContents.send('init-show', {
      targetFile, targetPos: pendingPos, failed: pendingFail,
      onDesktop: isDesktopTarget(targetFile),   // 桌面手動定位開關只對桌面目標生效
    });
  });
  // 與視窗載入並行定位檔案圖示
  findFilePosition(targetFile).then((pos) => {
    if (!showWin || showWin.isDestroyed()) return;
    if (!pos) {
      // 定位失敗:絕不退回游標位置(游標停在右鍵選單項上,必然瞄歪)。
      // 通知渲染端切手動瞄準(十字準星 + 點選),等頁面載入完再發也一樣。
      pendingFail = true;
      if (!showWin.webContents.isLoading()) showWin.webContents.send('auto-target-failed');
      return;
    }
    const scale = display.scaleFactor;
    // 工具保證輸出物理像素(內部自校準 UIA 座標空間,見 find-file-rect.cs),直接換算
    const tp = { x: pos.x / scale - bounds.x, y: pos.y / scale - bounds.y };   // 物理 → DIP → 視窗內座標
    if (showWin.webContents.isLoading()) pendingPos = tp;      // 還沒載入完,交給 init-show
    else showWin.webContents.send('auto-target', tp);
  });
}

// ---------- 素材路徑 ----------
// 打包後使用者素材在 %APPDATA%\niulai-deleter\assets(使用者資料目錄):
// 1) asar 歸檔清單是打包快照,後加檔案不可見(asar 補丁的 readdir 只返回清單條目)
// 2) app.asar.unpacked\assets 是程式檔案,覆蓋安裝會被整體替換,使用者素材必丟
// 所以首啟時把內建素材複製到使用者資料目錄,之後掃描/開啟都在那裡,安裝/解除安裝都不動它。
function assetsDir() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'assets')
    : path.join(app.getAppPath(), 'assets');
}
// 首次啟動:把內建素材複製到使用者資料目錄(已存在則跳過,不覆蓋使用者改動)
function ensureUserAssets() {
  if (!app.isPackaged) return;
  const dst = assetsDir();
  if (fs.existsSync(dst)) return;
  const src = path.join(process.resourcesPath, 'app.asar.unpacked', 'assets');
  if (!fs.existsSync(src)) return;
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
}

// ---------- IPC ----------
// scanCharacters 的結果含函式(spritePath 閉包),結構化克隆會失敗,
// 所以在這裡展平成純資料:paths.sprites / paths.audio 裡是已解析的絕對路徑
const SPRITE_KEYS = ['walk', 'point', 'kick', 'explosion', 'leo', 'fly'];
const AUDIO_KEYS = ['bgm', 'voice', 'explosion'];

// 角色自己的瞄準背景圖:資料夾下 targeting_bg.{png,jpg,jpeg}(可選,缺失渲染端
// 退化為黑色遮罩)。已裝舊版的使用者目錄裡沒有新檔案,先查使用者目錄,再查程式自帶
// 資源(app.asar.unpacked),兩個位置都能命中。
function targetingBgFor(folder) {
  const roots = app.isPackaged
    ? [assetsDir(), path.join(process.resourcesPath, 'app.asar.unpacked', 'assets')]
    : [assetsDir()];
  const rel = path.basename(folder);
  for (const root of roots) {
    for (const n of ['targeting_bg.png', 'targeting_bg.jpg', 'targeting_bg.jpeg']) {
      const p = path.join(root, rel, n);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

ipcMain.handle('scan-characters', () => {
  return characters.scanCharacters(assetsDir()).map((c) => ({
    id: c.id, name: c.name, description: c.description,
    folder: c.folder,
    sprites: c.sprites, texts: c.texts, animation: c.animation, tint: c.tint,
    targeting: c.targeting,
    targetBg: targetingBgFor(c.folder),   // 本角色瞄準背景圖(手動定位時繪製,原尺寸居中)
    paths: {
      sprites: Object.fromEntries(SPRITE_KEYS.map((k) => [k, c.spritePath(k)])),
      audio: Object.fromEntries(AUDIO_KEYS.map((k) => [k, c.audioPath(k)])),
    },
  }));
});
ipcMain.handle('get-last-character', () => characters.loadLastCharacter());
ipcMain.handle('save-last-character', (e, id) => characters.saveLastCharacter(id));
ipcMain.handle('get-manual-targeting', () => characters.loadManualTargeting());
ipcMain.handle('save-manual-targeting', (e, v) => characters.saveManualTargeting(v));
// 換角色後同步右鍵選單顯示名(只在打包版生效,dev 不註冊選單)
ipcMain.handle('update-context-menu-name', (e, name) => {
  if (!app.isPackaged) return null;
  const label = `召喚${name}摧毀`;
  for (const key of MENU_KEYS) {
    execFile('reg', ['add', key, '/ve', '/d', label, '/f'], () => {});
  }
  return label;
});
ipcMain.handle('trash-file', (e, file) => {   // 回收站(檔案已不存在則跳過,同原版 exists 檢查)
  if (!file || !fs.existsSync(file)) return { ok: false, reason: 'not-found' };
  return shell.trashItem(file)
    .then(() => ({ ok: true }))
    .catch((err) => ({ ok: false, reason: err.message }));
});

// 開啟 assets 目錄給使用者自定義角色(與掃描目錄同一位置,使用者資料目錄,安裝/解除安裝不動)
ipcMain.handle('open-assets-dir', () => shell.openPath(assetsDir()));   // 返回空字串 = 成功

// 讀取角色 config 檔案內容(右鍵卡片編輯用;沒有 config 時給預設模板)
ipcMain.handle('read-character-config', (e, folder) => {
  for (const n of ['config.jsonc', 'config.json']) {
    const p = path.join(folder, n);
    if (fs.existsSync(p)) {
      return { ok: true, file: n, content: fs.readFileSync(p, 'utf-8') };
    }
  }
  // 模板 = 內建牛來的完整註釋模板
  const template = path.join(assetsDir(), 'niulai', 'config.jsonc');
  return {
    ok: false,
    template: fs.existsSync(template) ? fs.readFileSync(template, 'utf-8') : '{\n  // 在此填寫配置\n}',
  };
});

// 寫回角色 config(編輯器儲存)
ipcMain.handle('write-character-config', (e, folder, content) => {
  try {
    fs.writeFileSync(path.join(folder, 'config.jsonc'), content, 'utf-8');
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err.message };
  }
});

ipcMain.on('open-character-window-for-swap', () => openCharacterWindow(true));
ipcMain.on('swap-character-selected', (e, charId) => {
  if (showWin && !showWin.isDestroyed()) showWin.webContents.send('swap-done', charId);
});
ipcMain.on('show-window-close', () => app.quit());
