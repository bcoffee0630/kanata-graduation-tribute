# 首頁背景影片驗證

驗證日期：2026-10-15（Asia/Taipei）。只更新公開前端；後台、後端、Rules 與資料不變。

## 實作

- 首頁 hero 背景由靜態圖改為官方 MV〈誰も見てない夢を見ろ / 天音かなた(official)〉（`IdXhY6zGC4s`，Kanata Ch. 天音かなた）。透過 YouTube IFrame API 以 `youtube-nocookie.com` 隱私強化模式嵌入，不下載、不自架影片。oEmbed 確認影片允許嵌入。
- 預設靜音自動播放並循環（瀏覽器只允許靜音自動播放），無 YouTube 控制列；播放器收到 `PLAYING` 才淡入，之前與失敗時都保留原本的 `kanata-header.png`，金色光暈、藍色漸層與亮度濾鏡仍疊在影片上。
- Hero 右下兩顆 44px 半透明按鈕：開啟／關閉聲音、暫停／播放。播放器 ready 才出現；標籤、tooltip 與圖示依實際播放狀態（非假設自動播放成功）與三語同步，Escape 可關閉 tooltip。
- 靜音影片離開畫面時暫停、回來時繼續；已開聲音則捲動時持續播放；使用者手動暫停的不會自動恢復。`prefers-reduced-motion` 時不自動播放，由使用者按播放。
- 影片無法嵌入（`onError`）或 `iframe_api` 被阻擋時移除播放器、隱藏按鈕，只顯示原圖。
- 播放器依 hero 以 cover 方式填滿，並保留 140px 垂直溢出，避免手機等矮 hero 露出 YouTube 標題列與暫停時的推薦影片列；桌面尺寸不受影響。

## 頁尾版權

- 素材來源列出背景影片標題、官方影片連結與官方頻道連結（取代原本的 `Header:` 字樣；繁中標題由「圖片來源」改為「素材來源」）。
- 新增說明：影片以 YouTube 嵌入播放器播放、本站未複製或再散布，播放時適用 YouTube 服務條款及 Google 隱私權政策，並附兩者與 hololive production 二次創作ガイドライン（`https://hololivepro.com/terms/`）連結。
- 既有非官方聲明、`© COVER Corp. / hololive production` 與非營利聲明保留。

## 本機證據

- `npm run test:build` 198／198 通過（新增 17 個 `header-video` VM 與標記案例）；production Hosting build（public 28 個允許檔案，含 `header-video.js`）、`git diff --check`、Gitleaks 通過。
- 內建瀏覽器以本機靜態伺服器驗證真實 YouTube 播放器：桌面 1280×720 與手機 390×844 皆自動播放並淡入，iframe 完整覆蓋 hero，無水平溢出；暫停／繼續、開聲音、靜音離開畫面暫停並恢復、有聲離開畫面持續播放，皆由播放器狀態事件反映在按鈕標籤上。三語切換的按鈕與頁尾文案正確。
- 靜態伺服器沒有 Firebase 設定與 API，console 只有 `/__/firebase/init.json` 及 `/api/*` 的 404，與本次變更無關。iOS／Android 實機的靜音自動播放與低電量模式行為需實機確認；API 被阻擋與 reduced-motion 由 VM 測試涵蓋。

版本：style CSS v11；i18n JS 與語系 JSON v11；header-video JS v1。

## 正式發布結果

- 經擁有者同意略過預覽（已檢視本機靜態版本），依 [純公開畫面增量發布](x-gallery-release.md#純公開畫面增量發布) 只發布 `hosting:public`。發布前確認 live version 與上次發布紀錄一致、無漂移。
- Code commit：`4b5cb38`；annotated tag：`governance-production-20261014T222438Z`。
- Live 發布時間：2026-10-14 22:25:49 UTC。Public 由 `36a85ddfc9182d02` 更新為 `1b27794c82e04b4f`；admin 維持 `0409bf142ca37ca0`。
- 七個變更檔案（根頁、style CSS、header-video／i18n JS、三份語系檔）的 SHA-256 與來源相同且為 `no-cache`。正式站桌面 1280×720：影片靜音自動播放並淡入、兩顆控制鈕顯示、頁尾素材來源已更新，回憶牆六篇與留言正常載入，無 console error、無水平溢出。

前後版本保存在忽略追蹤的 `.production-backups/hero-video-release.json`；若需回滾，將 public Hosting 回復至其中的 `before` 版本。
