# 區段浮動操作驗證

驗證日期：2026-10-07（Asia/Taipei）。本次只更新公開前端，取代六篇版原本的行內刷新與中央暫停操作。

## 實作

- 右下角沿用藍色圓形、白色 SVG、陰影與向左 tooltip。下方為返回頂部；上方在留言區顯示暫停／繼續，在回憶牆顯示刷新，同時最多兩顆。
- 扣除目前可見的固定導覽列後，以視窗垂直中線選擇區段；保留 24px 交界緩衝。區段高度、導覽列與 reveal 動畫改變時重新判定，沒有單純依交集判定而同時顯示兩個操作。
- 桌面 50px、手機 44px，沿用 12／10px 間距與 safe-area。Tooltip 支援 hover、鍵盤 focus、觸控 1.8 秒提示與 Escape；三語標籤及播放／暫停 SVG 隨狀態同步。
- 彈窗開啟時所有浮動操作隱藏、清除 tooltip／計時器並退出鍵盤入口。離開留言區不改變使用者暫停偏好。
- 移除行內刷新、中央暫停及兩條指定提示；兩個投稿按鈕保留原位置。檢舉按鈕仍在原控制區，未選取留言時不留下控制區空白。
- 自己投稿仍立即置頂並沿用成功 Toast；六篇規則、刷新額度、快取期限、錯誤回饋與 iframe 保留均維持。語系切換、409 回應與版本更新不能重新顯示已移除提示。

## 本機證據

全部瀏覽器互動使用 Codex **@Browser**，沒有啟動外部或獨立 headless 瀏覽器。桌面 1280×720、手機 390×844 為響應式模擬，沒有宣稱真實 iPhone／WebKit 驗收。觸控 timer 與背景切換以 VM 行為測試覆蓋，Browser 的尺寸模擬不當作實體觸控證據。

- 留言播放→浮動暫停：既有動畫 `animationPlayState` 全部變為 `paused`，圖示切換為播放；恢復後繼續。切到其他區段後仍保留偏好。
- 留言中線仍在區段、回憶牆標題已露出的手機交界：顯示留言操作；頁尾只顯示返回頂部。沒有水平溢出，兩顆可見按鈕各 44px。
- 投稿及留言檢舉彈窗：所有浮動操作隱藏，焦點留在彈窗。選取留言仍出現原檢舉按鈕，取消選取後控制區高度為 0。
- 三語切換保留 SVG 與暫停狀態，tooltip／ARIA 相符；Tab 可移到返回頂部並顯示 tooltip，Escape 後 tooltip opacity 為 0。
- 本機六篇成功換批：保留所有重疊 iframe 的 instance，定位到第一篇；模擬 503 回應後卡片 instance 及捲動位置完全不變，保留錯誤提示。
- 刷新等待→透過導覽切到留言→暫停→回應成功：回應接受六篇，仍顯示「繼續留言」，刷新恢復可用，`scrollY` 在回應前後均為 892.5。原先只判斷回憶牆有交集會搶捲動，已改為刷新按鈕仍顯示才允許定位；原因與修正信心度約 99%。
- 模擬安全投稿 item 回應仍置頂、裁掉第七篇；提示節點不存在，gallery status 保持空白。成功 Toast 的既有投稿程式沒有修改。

CLI 使用既有 Node.js 22，`npm run test:build` 共 171／171 通過，production Hosting build 產生 public／admin／maintenance 26／15／3 個允許檔案；`git diff --check` 與 Gitleaks 通過。新增 21 個浮動控制 VM 案例，畫廊共 32 案例（包含交界刷新競態），留言及共用 watcher 共 14 案例。規則與後端沒有變更，本次不重跑外部瀏覽器 E2E。

## 發布與回滾

依 [純公開畫面增量發布](x-gallery-release.md#純公開畫面增量發布) 執行：保存當前 public／admin live release、提交並建立 annotated release tag、驗證公開 Hosting preview，再核對乾淨 HEAD／tag 與 live 無漂移後只發布 `hosting:public`。

根頁、三份變更 CSS、四份變更 JS、三份語系檔需回讀來源雜湊與 `no-cache`；公開 feed 維持原一秒快取與新鮮有效期。忽略追蹤的 `.production-backups/floating-controls-release.json` 保存確切前後 public／admin 版本與 HTTP 證據。若失敗，僅用保存的上一個 public version 回滾。

版本：style／gallery／danmaku CSS v7；gallery JS v9；danmaku／scroll-top JS v7；i18n JS 與語系 JSON v8。

## 正式發布結果

- Code commit：`51d8c48`；annotated tag：`governance-production-20261007T072549Z`。
- Public preview：[floating-controls-validation](https://kanata-memorial--floating-controls-validation-mxdfcv2t.web.app/)，只發布公開 Hosting，使用真實六篇 X 嵌入與兩則留言。桌面 1280×720、手機 390×844 的操作及排版驗收通過，console error／warning 為 0。
- Live 發布時間：2026-10-07 07:30:19.603 UTC。Public 由 `224b84e215741df3` 更新為 `17cecc720dcec90f`；admin 仍為 `faeee9014835b330`，release identity 完全未變。
- 發布前 clean annotated tag、current live baseline 與再次 no-drift 核對均通過。只執行 `firebase deploy --only hosting:public`，沒有後端、Rules、admin 或維護鎖寫入。
- [正式網站](https://eienkanata.com/) 根頁與十個變更資產的 SHA-256 均與本次來源相同，全部 `Cache-Control: no-cache`；version／gallery／messages API 維持一秒 CDN 快取、新鮮期限與六篇／100 則上限，回讀實際為六篇及兩則。
- 正式 Codex @Browser：六個真實 X 元件 ready，刷新後第一排距視窗上緣約 68px，hover 顯示繁中 tooltip；留言浮動按鈕確實暫停既有動畫。390×844 兩個操作各 44px、無水平溢出、暫停偏好保留，console error／warning 為 0。驗收後恢復正常播放及預設 Browser 視窗尺寸。

完整前後版本、回滾基線、preview 與 HTTP 證據保存在忽略追蹤的 `.production-backups/floating-controls-release.json`。本段是發布後文件補記，code release tag 保持指向實際部署的提交。

## Out-of-Scope

後端、公開 API、快照與成本機制、IAM／Rules、每日配額、投稿視窗與教學、X 內容裁切及歷史搜尋不變。本次不操作維護鎖、Owner Password session、Billing 通知或站台停用；不執行外部／headless／真機測試，不建立正式測試投稿或檢舉。
