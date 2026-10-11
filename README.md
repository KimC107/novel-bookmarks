# 愛好書簽 PWA

管理小說與漫畫的閱讀進度，iOS / Mac / Android 透過 Firebase 同步。純靜態檔，無需 build。

## 本機測試

```bash
cd ~/Desktop/AI/novel-bookmarks
python3 -m http.server 8765
# 開 http://localhost:8765
```

`firebase-config.js` 仍是 `PASTE_HERE` 時，會進入「本機示範模式」（資料只存在該瀏覽器，不同步），方便測 UI。
填入 Firebase 設定值後自動切換成雲端同步。

## 資料結構

`users/{uid}/novels/{id}`：type(小說/漫畫，缺少視為小說), title, author, siteUrl, chapterName, chapterUrl, status(進行/追更/未看/已閱/棄坑；舊值在看/想看/看完會自動轉換), rating(0-5), tags[], note, createdAt, lastReadAt

## 部署

GitHub Pages（Settings → Pages → main / root）。部署後需把網域加進 Firebase Authentication 的「授權網域」。

## 尚未納入第一版

封面圖、iOS 捷徑（URL 參數帶入新增）、自動偵測章節更新。
