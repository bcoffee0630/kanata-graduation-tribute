# 回憶牆細節與後台治理改進驗證

驗證日期：2026-10-11（Asia/Taipei）。本次只更新公開與後台前端；後端、公開 API、Rules、索引、資料與維護鎖不變。

## 實作

- 公開站：X 嵌入載入骨架與完成淡入；失敗後援改為 X logo「開啟原始貼文」與帶圖示的重試。一般狀態使用中性色，只有 `load_error`／`unavailable` 為錯誤色。刷新浮動按鈕以小圓點與「有新的投稿」標籤提示新投稿，刷新後清除；刷新圖示改用對稱的 Lucide `refresh-cw`，刷新中旋轉。
- 浮動按鈕：進場縮放淡入；離場以 `transition-behavior: allow-discrete` 淡出，`hidden` 仍立即設定。離場按鈕移出排版並固定在原位，區段切換時兩顆按鈕在同一位置交疊。
- 手機單欄卡片上限 300px → 360px；檢舉改旗子圖示；投稿按鈕改 X logo；貼上連結自動預覽；彈窗關閉鈕 40×40、`dvh` 高度；留言彈窗補 dialog 屬性。`og:url`／`og:image` 改為 eienkanata.com 絕對網址，新增 `twitter:card`，分享改 `x.com/intent/post`，導覽「Twitter」改「X」。
- 後台：X 投稿在清單、舉報與用戶近期投稿顯示 `@handle · postId` 及原文連結；案件／投稿／用戶抽屜有載入與錯誤重試；處置操作進行中停用按鈕避免重複送出；稽核紀錄與目標類型可讀化；管理員操作有專屬確認文字；modal／抽屜還原焦點；「創作」統一為「畫廊投稿」；顯示狀態篩選標示只涵蓋最新 50 筆。

## 本機證據

- `npm run test:build` 173／173 通過；production Hosting build 產生 public／admin／maintenance 26／15／3 個允許檔案；`git diff --check` 與 Gitleaks 通過。
- e2e：完整執行時有逾時與既有不穩定案例。修正兩個在浮動操作改版後已過時的 gallery 斷言後，desktop／mobile 的 gallery、admin、public-feed 107 項通過。最後的浮動按鈕離場修正後重跑 gallery／public-feed：79 項通過、2 項失敗（`public-feed:89`、mobile `gallery:389`），這兩項各重複三次共 12 次全部通過。`public-feed:99` 在未修改程式碼上同樣失敗。WebKit 的 `page.goto` 30 秒逾時屬載入等待，非斷言失敗。
- 公開站以本機 fixture 伺服器、後台以 emulator Owner 實際操作驗證；浮動按鈕離場位置與透明度以 headless Chromium 在 1280／390 寬取樣。

## 發布結果

- Code commit：`d8824a2`；annotated tag：`governance-production-20261011T140524Z`。
- 發布前 live：public `17cecc720dcec90f`、admin `faeee9014835b330`，與前次紀錄一致；預覽後與發布前兩度確認無漂移。
- Preview：public `x-gallery-polish` 與 admin `admin-governance` channel，以 headless Chromium 驗收（內建瀏覽器面板隱藏時會暫停動畫與延遲載入）。X `widgets.js` 在此網路需 10–24 秒，同時段 live 也出現相同嵌入失敗，屬網路差異。
- Live 發布 2026-10-11 14:16:34 UTC（public `594b184b8697e902`）與 14:16:59 UTC（admin `0409bf142ca37ca0`）。只執行 `firebase deploy --only hosting:public` 與 `deploy:production --phase admin-live`。
- 公開與後台根頁及 17 個變更資產（共 19 個檔案）的 SHA-256 與來源相同；public 為 `no-cache`（`modal.css` 為預設 1 小時快取，但本次改用新的 `?v=2` 網址），admin 為 `no-store`。
- 正式站 headless Chromium：桌機與手機六個真實 X 元件 ready、無水平溢出、無 console error／warning。後台只驗證到登入畫面，未使用 Owner 登入。

確切前後版本、預覽與 HTTP 證據保存在忽略追蹤的 `.production-backups/x-gallery-polish-release.json`。若需回滾，以其中的 `before` 版本分別回復 public 與 admin Hosting。
