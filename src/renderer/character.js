// 角色選擇視窗 —— 卡片渲染 + 選擇即儲存
// 換角模式(?swap=1):演出中"換一隻"開啟,選中後通知演出視窗並關閉
const SWAP_MODE = new URLSearchParams(location.search).get('swap') === '1';

const cardsEl = document.getElementById('cards');
const statusEl = document.getElementById('status');
const emptyEl = document.getElementById('empty');
const randomBtn = document.getElementById('random');
const manualToggle = document.getElementById('manual-toggle');

// 桌面手動定位開關:讀取上次選擇,勾選即持久化(見 show.js:手動模式下召喚直接出十字準星)
window.api.getManualTargeting().then((v) => { manualToggle.checked = !!v; });
manualToggle.onchange = () => window.api.saveManualTargeting(manualToggle.checked);

let chars = [];

// 預覽圖 = 走路 spritesheet 第一幀(5×3 切片,高 110,同原版 preview_pixmap)
async function previewUrl(path) {
  if (!path) return null;
  const img = new Image();
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = window.api.toFileUrl(path);
  });
  const fw = img.naturalWidth / 5, fh = img.naturalHeight / 3;
  const cv = document.createElement('canvas');
  cv.width = fw; cv.height = fh;
  cv.getContext('2d').drawImage(img, 0, 0, fw, fh, 0, 0, fw, fh);
  return cv.toDataURL('image/png');
}

async function renderCards(last) {
  for (const c of chars) {
    const card = document.createElement('div');
    card.className = 'card' + (c.id === last ? ' selected' : '');

    const url = await previewUrl(c.paths.sprites.walk);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      card.appendChild(img);
    }

    const name = document.createElement('div');
    name.className = 'name';
    name.textContent = c.name;

    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = c.description;

    card.append(name, desc);
    card.onclick = () => selectCharacter(c, card);
    cardsEl.appendChild(card);
  }
}

async function selectCharacter(c, card) {
  await window.api.saveLastCharacter(c.id);
  window.api.updateContextMenuName(c.name);   // 右鍵選單名跟隨所選角色
  if (SWAP_MODE) {
    window.api.swapCharacterSelected(c.id);   // 通知主程序轉給演出視窗
    window.close();
    return;
  }
  document.querySelectorAll('.card.selected').forEach((el) => el.classList.remove('selected'));
  card.classList.add('selected');
  statusEl.textContent = `當前預設角色：${c.name}`;
}

async function init() {
  chars = await window.api.scanCharacters();
  if (!chars.length) {
    cardsEl.style.display = 'none';
    randomBtn.style.display = 'none';
    emptyEl.style.display = 'block';
    return;
  }
  const last = await window.api.getLastCharacter();
  await renderCards(last);

  const cur = chars.find((c) => c.id === last) || chars[0];
  if (cur) statusEl.textContent = `當前預設角色：${cur.name}`;

  randomBtn.onclick = () => {
    const c = chars[Math.floor(Math.random() * chars.length)];
    selectCharacter(c, cardsEl.children[chars.indexOf(c)]);
  };
}
init();

// 自定義角色:開啟 assets 目錄(手冊和怪獸資料夾都在裡面)
const customBtn = document.getElementById('custom-btn');
customBtn.onclick = async () => {
  const err = await window.api.openAssetsDir();
  if (err) statusEl.textContent = '開啟 assets 目錄失敗:' + err;
};

// ---------- 右鍵角色卡片:編輯配置檔案(CodeMirror) ----------
const ctxMenu = document.getElementById('ctx-menu');
const configModal = document.getElementById('config-modal');
const modalTitle = document.getElementById('modal-title');
const errEl = document.getElementById('config-err');
let ctxChar = null;   // 當前右鍵的角色
let editor = null;

document.addEventListener('contextmenu', (e) => {
  const card = e.target.closest('.card');
  if (!card) return;
  e.preventDefault();
  ctxChar = chars[Array.from(cardsEl.children).indexOf(card)];
  if (!ctxChar) return;
  ctxMenu.style.display = 'block';
  ctxMenu.style.left = Math.min(e.clientX, innerWidth - 190) + 'px';
  ctxMenu.style.top = Math.min(e.clientY, innerHeight - 80) + 'px';
});
document.addEventListener('click', () => { ctxMenu.style.display = 'none'; });

// 與 characters.js 相同的註釋剝離(儲存前校驗 JSONC 用)
function stripComments(text) {
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
    if (ch === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++;
      out += '\n';
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      i += 2;
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++;
      i++;
      continue;
    }
    out += ch;
  }
  return out;
}

document.getElementById('ctx-edit-config').onclick = async () => {
  ctxMenu.style.display = 'none';
  errEl.textContent = '';
  const r = await window.api.readCharacterConfig(ctxChar.folder);
  modalTitle.textContent = `${ctxChar.name} - ${r.ok ? r.file : '無配置檔案(儲存將建立)'}`;
  if (!editor) {
    editor = CodeMirror.fromTextArea(document.getElementById('config-editor'), {
      mode: { name: 'javascript', json: true },
      theme: 'monokai',
      lineNumbers: true,
      lineWrapping: true,
      tabSize: 2,
    });
  }
  editor.setValue(r.ok ? r.content : r.template);
  configModal.style.display = 'flex';
  editor.refresh();
};

document.getElementById('modal-close').onclick = () => { configModal.style.display = 'none'; };
configModal.addEventListener('click', (e) => { if (e.target === configModal) configModal.style.display = 'none'; });

document.getElementById('config-save').onclick = async () => {
  errEl.textContent = '';
  const content = editor.getValue();
  try {
    JSON.parse(stripComments(content));   // 儲存前校驗
  } catch (e) {
    errEl.textContent = '❌ 語法錯誤:' + e.message;
    return;
  }
  const r = await window.api.writeCharacterConfig(ctxChar.folder, content);
  if (r.ok) {
    location.reload();   // 重新整理卡片(下次召喚的參數下次掃描即生效)
  } else {
    errEl.textContent = '❌ 儲存失敗:' + (r.message || '未知錯誤');
  }
};

// 如何解除安裝:彈出可關閉的說明卡片
const uninstallModal = document.getElementById('uninstall-modal');
document.getElementById('uninstall-btn').onclick = () => { uninstallModal.style.display = 'flex'; };
document.getElementById('uninstall-close').onclick = () => { uninstallModal.style.display = 'none'; };
uninstallModal.addEventListener('click', (e) => { if (e.target === uninstallModal) uninstallModal.style.display = 'none'; });

// Esc:standalone 關閉視窗(應用退出);換角模式只關視窗,演出視窗繼續(原版 keyPressEvent)
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (uninstallModal.style.display === 'flex') { uninstallModal.style.display = 'none'; return; }
    window.close();
  }
});
