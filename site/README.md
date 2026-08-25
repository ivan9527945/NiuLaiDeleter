# NiuLaiDeleter 形象網站

單頁靜態站，由零依賴的 Node server 服務（`server.js`），部署在 Railway。

## 本機執行

```bash
cd site
PORT=4000 node server.js     # → http://localhost:4000
```

沒有任何 npm 依賴，不需要 `npm install`。

## 部署

```bash
cd site
railway up
```

Railway 專案 `niulai-site` / 服務 `niulai-site` / 環境 `production`。
連結資訊存在 Railway CLI 的全域設定裡、**以絕對路徑為 key**，
所以搬動這個資料夾之後要重新連結：

```bash
railway link -p niulai-site -s niulai-site -e production
```

## 結構

```
server.js           # 靜態檔伺服器：聽 $PORT，含目錄穿越防護
public/index.html   # 整站單頁（設計 token 集中在 :root）
public/walk.png     # 走路 spritesheet 橫條（15 格，CSS steps(15) 播放）
public/kick.png     # 踢踹 spritesheet 橫條
public/leo.png      # 登場 spritesheet 橫條
public/logo.png     # OG 圖
public/favicon.png
```

`*.png` 的橫條圖是從 `assets/niulai/` 的 5×3 spritesheet 攤平而來，
角色素材本身由 `tools/gen_niulai.py` 產生。
