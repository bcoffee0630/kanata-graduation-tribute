# 底部分享功能修正驗證

驗證日期：2026-10-11（Asia/Taipei）。只更新公開前端；後台、後端、Rules 與資料不變。

## 問題與修正

- X 與系統分享原本分享 `location.href`，會帶入訪客所在區段與追蹤參數（例如 `?utm_source=…#danmaku-section`）。現在一律分享 `og:url` 宣告的 `https://eienkanata.com/`。
- 系統分享原本使用載入時的日文標題且無文字；現在於點擊時帶入目前語系的標題與 `footer.post_text`。關閉分享面板（`AbortError`）視為正常操作。
- 不支援 Web Share API 的瀏覽器原本直接隱藏按鈕；現在改為「複製連結」（連結圖示），成功顯示提示，失敗時在提示中顯示網址。`toast.js` 的 `Toast` 為頁面層級宣告而非 `window` 屬性，分享模組兩者皆支援。
- X 按鈕改為真正的 intent 連結，觸控裝置可交由 X App 開啟；桌面維持 `noopener` 小視窗。按鈕改為 X 黑色並提供三語標籤。分享邏輯由內嵌程式移至 `assets/js/share.js`。

## 驗證

- `npm run test:build` 181／181 通過（新增 8 個分享案例）；production Hosting build、`git diff --check`、Gitleaks 通過。
- 本機與正式站以 Playwright 驗證：桌面 Chromium 複製連結寫入正確網址並顯示提示；iPhone WebKit 與 Android Chromium 模擬攔截傳給分享面板的資料，標題、文字與網址正確。真機上 X App 接手與實際分享面板需實機確認。
- 經擁有者同意略過預覽，直接發布以便多裝置實測。Code commit `20c444f`，annotated tag `governance-production-20261011T144508Z`；public 由 `594b184b8697e902` 更新為 `36a85ddfc9182d02`（2026-10-11 14:45:43 UTC），admin 維持 `0409bf142ca37ca0`。七個變更檔案的 SHA-256 與來源相同且為 `no-cache`。

前後版本保存在忽略追蹤的 `.production-backups/footer-share-release.json`；若需回滾，將 public Hosting 回復至其中的 `before` 版本。
