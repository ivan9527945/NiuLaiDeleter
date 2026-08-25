// 極簡靜態站伺服器：零依賴，只服務 public/ 底下的檔案。
// Railway 會注入 PORT，必須聽那個埠而不是寫死。
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

http.createServer((req, res) => {
  // 只取 pathname，丟掉 query；decode 後再正規化,避免 ../ 逃出 public/
  // 不用 new URL()：req.url 若是 "//" 會被當成 protocol-relative 而拋錯,
  // 而 "//" 是合法請求(爬蟲/proxy 會送),不該回 400。
  let rel;
  try {
    const q = req.url.indexOf('?');
    rel = decodeURIComponent(q === -1 ? req.url : req.url.slice(0, q));
  } catch {
    res.writeHead(400).end('bad request');
    return;
  }
  if (!rel.startsWith('/')) rel = '/' + rel;
  if (rel.endsWith('/')) rel += 'index.html';

  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {          // 目錄穿越防護
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<h1>404</h1><p>這裡沒有東西。牛可能已經把它踹掉了。</p>'
            + '<p><a href="/">回首頁</a></p>');
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      'content-type': MIME[ext] || 'application/octet-stream',
      // 圖片可以長快取，HTML 每次重驗證，否則改版後使用者看到舊頁
      'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=604800',
    });
    res.end(buf);
  });
}).listen(PORT, '0.0.0.0', () => {
  console.log(`niulai-site listening on ${PORT}`);
});
