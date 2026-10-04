# X 畫廊驗證紀錄

驗證日期：2026-10-05（Asia/Taipei）。發布與回滾操作見 [X 畫廊增量發布](x-gallery-release.md)。

## 已完成

- Homebrew Node 22 已修復為 22.23.3；根目錄與 Functions 已依 lockfile 執行 `npm ci`。`.nvmrc` 與 Functions runtime 維持 Node 22，沒有新增 X SDK 或 API 金鑰。
- Functions 單元測試 33、建置／匯入防護測試 32、Firestore／Storage 規則測試 12、整合測試 14，共 **91 項通過**。
- 完整 Playwright：**16 項通過**；另 6 項因同一案例只適用桌面或手機而按設定略過，沒有失敗。涵蓋分頁、ResizeObserver 高度變更、語系切換競態、教學、預覽、焦點進出、失敗重試、登入投稿、配額與後台原文連結。
- Production Hosting build 通過，public／admin／maintenance 分別只有 25／15／3 個允許發布的檔案。`git diff --check` 與 Gitleaks 目錄掃描通過。
- 真實 CLI 匯入在 demo 模擬器驗證：dry-run 沒有寫入、apply 新增 3、重跑略過 3，Timestamp 正常序列化、稽核 3 筆、daily 2／pending 1 未改。測試 fixture 以 finally 清理，不影響既有最後一位 Owner 的保護測試。
- 本機畫廊以三篇真實官方 X 嵌入驗收：1040px 雙欄、390px 手機單欄，均無水平溢出；四個 gallery／preview 元件共用單一 widgets script。繁中教學與 Escape 焦點復原實際驗收通過。本機測試使用 demo 模擬器，正式匯入另依下列發布紀錄執行。
- Staging `kanata-memorial-admin` 的 18 個 Functions 全部 ACTIVE／Node 22；最終前端已發布至 [admin-governance 預覽](https://kanata-memorial-admin--admin-governance-bxf8cd81.web.app/#gallery-section)，公開空畫廊與既有導覽驗收通過。
- Production 的 ADC／Firebase CLI 專案存取及既有 Owner 帳號唯讀檢查通過；參考作品預演為 add 3／skip 0。既有 11 個索引完整保留，新 X 畫廊分頁索引建置後，12 個索引皆 READY。
- 正式畫廊發布完成，程式版本為 `8c88727`、annotated tag 為 `governance-production-20261004T161305Z`。增量 baseline 為 `.production-backups/baseline-20261004T163421Z.json`，上一版 tag 為 `governance-production-20260710T214458Z`。
- 維護期間的最終 Firestore export 成功完成，備份為 `gs://kanata-memorial.firebasestorage.app/governance-backups/20261004T163548Z-final/firestore`，manifest 為 `.production-backups/20261004T163548Z-final.json`。當時非備份 Storage 物件為 0，因此沒有來源媒體需要複製。
- 正式後端驗證通過：18 個 ACTIVE／Node 22 Functions、12 個 READY 索引、16 個所需 HTTP invoker、15 個匿名 callable 拒絕，Owner bootstrap 停用。紀錄為 `.production-backups/backend-verification-20261004T164224Z.json`。
- 以實際 Owner Password session 完成三篇正式匯入，新增 3 筆 X 投稿與 3 筆管理稽核。Owner 身分透過現有 Firebase SDK 與管理員身分驗證確認；一次性本機登入交接使用 in-memory persistence，token 僅經 child stdin 交給 importer，完成後交接程式已關閉、記憶體 session 已清除。未以 ADC 偽造 Owner session，也未重設帳號。
- 公開 Hosting 成功發布後解除維護，唯讀檢查確認三篇均可見、當日資格查核日期為 2026-10-05。正式官方 widget 顯示 `#かなたーと` 與 679／4,423／5,551 讚；桌面 1040px、504px 兩欄、32px 欄距，390px 手機 350px 單欄，均無水平溢出。三篇共用一個 widgets script；投稿者標示與檢舉登入限制驗收通過。

## 驗收範圍

完整 Google／GitHub 登入投稿、並行去重、每日額度與檢舉隱藏／還原／移除在模擬器驗證；正式環境沒有為驗收額外建立投稿或檢舉資料。真實第三方嵌入在本機與正式網站驗收；Staging 公開畫廊保持空白，尚未啟用社群 OAuth。

`curated-fanart.json` 的 2026-10-04 觀察值保留為原始策展紀錄；2026-10-05 的官方元件與 oEmbed 查核是這次正式匯入前的再次確認。

正式發布、匯入與上述 smoke check 結果信心度高；第三方貼文與讚數仍會隨 X 的狀態變動。

## 追加畫面修正

- 使用者在 691px 的治理後台指出側邊欄問題。實際畫面與 CSS 確認：224px 手機抽屜誤用桌面收合的隱藏文字樣式，收合後仍覆蓋主內容。修正將桌面收合限制在 761px 以上；手機收合改為關閉抽屜，保留桌面偏好，補齊三語狀態標示、導覽 accessible names、Escape 與焦點復原。
- 後台完整 Playwright：8 項通過，6 個既有桌面／手機限定案例依設定略過，沒有失敗；含新增的兩個側邊欄回歸案例。32 個建置／匯入防護測試與 Production Hosting build 再次通過。
- 使用者在 691px 正式畫廊指出嵌入偏左。官方 wrapper 的 inline `max-width: 550px` 被網站 `max-width: 100% !important` 覆蓋，擴到 633px，內部貼文本體仍為 550px。修正保留官方寬度限制，並把共用嵌入 frame 的最大寬度設為 550px、左右自動留白，同時套用於畫廊與投稿預覽。
- 畫廊完整 Playwright：12 項通過，沒有失敗；官方 widget 的測試替身保留 550px 限制。新增兩個案例驗證初始尺寸與 691px → 1440px → 390px → 691px 切換，以及 691px／390px 投稿預覽的左右留白差小於 1px、沒有水平溢出。後台與畫廊最新 E2E 合計 20 項通過、6 個既有條件略過，加上 91 個功能／建置／規則／整合測試，共 111 項通過。
