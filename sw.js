// Service Worker：快取 App 外殼讓離線也能開啟；資料離線快取由 Firestore 本身處理
const CACHE = "novel-bookmarks-v2";
const SHELL = ["./", "index.html", "style.css", "app.js", "firebase-config.js", "manifest.webmanifest", "icon-192.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  // 清掉舊版本快取
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // 只處理同源 GET；Firebase / Google 請求一律走網路
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // 網路優先，失敗才用快取（避免更新後吃到舊檔）
  e.respondWith(
    // no-cache：每次都向伺服器驗證，不吃瀏覽器 HTTP 快取（GitHub Pages 預設 max-age=600，會讓更新延遲 10 分鐘）
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
