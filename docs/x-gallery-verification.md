# X 畫廊驗證紀錄

驗證日期：2026-10-05（Asia/Taipei）。發布與回滾操作見 [X 畫廊增量發布](x-gallery-release.md)。

## 已完成

- Homebrew Node 22 已修復為 22.23.3；根目錄與 Functions 已依 lockfile 執行 `npm ci`。`.nvmrc` 與 Functions runtime 維持 Node 22，沒有新增 X SDK 或 API 金鑰。
- Functions 單元測試 33、建置／匯入防護測試 32、Firestore／Storage 規則測試 12、整合測試 14，共 **91 項通過**。
- 完整 Playwright：**16 項通過**；另 6 項因同一案例只適用桌面或手機而按設定略過，沒有失敗。涵蓋分頁、ResizeObserver 高度變更、語系切換競態、教學、預覽、焦點進出、失敗重試、登入投稿、配額與後台原文連結。
- Production Hosting build 通過，public／admin／maintenance 分別只有 25／15／3 個允許發布的檔案。`git diff --check` 與 Gitleaks 目錄掃描通過。
- 真實 CLI 匯入在 demo 模擬器驗證：dry-run 沒有寫入、apply 新增 3、重跑略過 3，Timestamp 正常序列化、稽核 3 筆、daily 2／pending 1 未改。測試 fixture 以 finally 清理，不影響既有最後一位 Owner 的保護測試。
- 本機畫廊以三篇真實官方 X 嵌入驗收：1040px 雙欄、390px 手機單欄，均無水平溢出；四個 gallery／preview 元件共用單一 widgets script。繁中教學與 Escape 焦點復原實際驗收通過。上述參考資料僅寫入 demo 模擬器。
- Staging `kanata-memorial-admin` 的 18 個 Functions 全部 ACTIVE／Node 22；最終前端已發布至 [admin-governance 預覽](https://kanata-memorial-admin--admin-governance-bxf8cd81.web.app/#gallery-section)，公開空畫廊與既有導覽驗收通過。
- Production 的 ADC／Firebase CLI 專案存取及既有 Owner 帳號唯讀檢查通過；參考作品預演為 add 3／skip 0。既有 11 個索引皆 READY 且完整保留，唯一新增索引為 X 畫廊分頁所需。

## 尚未完成的正式發布步驟

正式環境尚未寫入三篇參考投稿，也尚未切換維護、部署新版 backend／Rules／Hosting。匯入需要實際 Owner 的 Password-session ID token，不能以 ADC 或指定 UID 替代。取得該登入身分交接後，依發布手冊完成 maintenance、final backup、backend／索引驗證、Rules／後台、匯入及 public release。

Staging 尚未啟用社群 OAuth；完整 Google／GitHub 投稿流程以模擬器測試驗證。正式匯入前需再核實三篇仍公開可嵌入、含 `#かなたーと` 且超過 100 讚。`curated-fanart.json` 的 2026-10-04 觀察值保留為原始策展紀錄。

工程可行性與目前測試結果信心度高；正式發布完成與否須以實際部署、匯入及 smoke check 結果為準。
