# 六篇回憶牆與近即時留言驗證紀錄

驗證日期：2026-10-07（Asia/Taipei）。本次結果取代先前四篇版紀錄。程式與本機驗證已完成；尚未部署 staging／production，尚未量測真實 Cloud Tasks、CDN、X 嵌入與費用。

## 已完成

- 固定 compact、最多最新兩篇＋隨機四篇，移除尺寸偏好、尺寸切換／提示與兩個浮動畫廊按鈕。名稱及說明依使用者指定更新三語。
- 原投稿位置保留，旁邊新增不需登入的刷新；兩個操作觸控目標至少 44px。返回頂部保留三語 tooltip，彈窗開啟時隱藏並退出焦點入口。
- 整個換批、自己投稿插入與重排保護高度；視窗只改高度不重排。重疊 X 投稿保留 iframe，失敗保留卡片／位置，成功在仍閱讀區段且未開啟彈窗時定位第一篇。
- 自己的安全公開 item 立即置頂，最多六篇；較早刷新回應不能覆蓋新投稿。偵測其他人新內容只提示；主動刷新恢復最新兩篇＋隨機四篇。
- 手動網路刷新每滾動六十秒五次，失敗也計次；跨分頁額度共享，儲存受限有 fallback。本地候選最多 48 篇，版本更新清除舊候選，換組不能續期，過期不能重新抽樣。
- 留言增量加入下一個可用軌道；保留剩餘播放佇列、既有動畫與已開啟內容。自己的留言立即加入，暫停／背景維持暫停；期限到後停止重新循環。
- 私有 revision／約兩秒合併的 Cloud Tasks worker、三次重試、一分鐘 watchdog、五分鐘八組輪替、bounded 查詢與 CAS 發布。留言 revision 不變不重查；十二小時 artifact 複製只用 Storage。
- 共用前景／可見區段版本檢查器，每兩秒檢查，失敗退避至六十秒。公開 reader 不具 Firestore 權限，只讀固定快照 key，maxInstances=1、single-flight 與實例 100/s、burst 200 限流。
- 投稿／檢舉每帳戶每端點五次／分鐘，額度查詢二十次／分鐘；既有登入、每日配額、帳號限制、管理員治理及維護鎖保留。
- 已移除本機上一版 Budget Pub/Sub、費用門檻、成本初始化／恢復工具、control.json 及投稿／檢舉 cost gate。NT$500 超額不影響正常操作；Cloud Billing 通知由使用者管理。

## CLI 測試

| 範圍 | 結果 |
|---|---|
| TypeScript build | 通過 |
| Preview／public／admin／maintenance Hosting build | 通過 |
| Functions unit tests | 92 通過；最後 revision 回退修正另跑相關 23 tests 通過 |
| 前端 VM、建置／發布工具 tests | 74 通過 |
| 正常／維護 Firestore 與 Storage Rules | 14 通過 |
| Firebase emulator integration tests | 28 通過 |
| Gitleaks 工作目錄／全部 Git 歷史、diff whitespace | 通過 |

前端 VM 測試不開啟瀏覽器，涵蓋延遲回應、版本淘汰／續期、自己投稿競態、限流／跨分頁、儲存失效、快取到期、留言增量／暫停／背景、過期自己的內容與退避。後端涵蓋事件重送、窗口尾端、發布失敗、CAS 競態、watchdog、來源 revision 回退、訪客讀取不增加來源抽樣，以及安全 callable item／連點限制。TTL release verifier 要求遠端兩個 expiresAt 政策為 ACTIVE。

更新的 Playwright E2E 檔案保留作為測試規格，**本次不執行**；不以舊四篇版或外部瀏覽器結果代表本次通過。

## Codex Browser 響應式驗證

全部互動測試使用 [@Browser](plugin://browser@openai-bundled)，沒有啟動外部或獨立 headless 瀏覽器。網址 `http://127.0.0.1:5188/`，載入實際前端程式；測試工具只存在 `/tmp`，快照 API／X iframe 與登入是本機 fixture，不會發布，也不寫遠端資料。

- 桌面 1440×1000／900×900，手機 393×852／393×720；桌面三欄、窄手機一欄 compact，沒有水平溢出。
- 0／1／6／7／14 篇來源分別顯示 0／1／6／6／6；不足六篇顯示實際數量。
- 桌面嵌入高度及視窗高度變化未跳回起點。手機複查找到捲動錨定造成的重排位移，已停用該區段 overflow-anchor 並保留量測時的格線位置。實際 393×720、閱讀第 3 張時，六個 iframe 連續三次各增加 80px：scrollY 始終 2101，Grid 每次增高 480px，第 3 張只自然下移 160px；720→852 高度變更也維持 scrollY。原生座標點擊排除 locator 自動捲動干擾。
- 刷新成功定位第一張，重疊最新投稿的 iframe 實例 ID 保留；API 失敗案例 scrollY 1323.5 前後一致，原六張卡片保留。
- 自己投稿在第一張、總數六張，其餘五張 iframe 保留。刷新等待中的自己投稿不被覆蓋；另有 VM deferred-request 競態測試。
- 暫停留言時自己的新留言不播放，恢復後優先出現；fixture 新共用留言約 1.1 秒後顯示。此數字只驗證前端，不代表 staging 3–8 秒目標已通過。
- 繁中／日文／英文名稱、說明與刷新文案已驗證。模擬登入後分享彈窗可開啟、初始焦點正確，返回頂部隱藏；Escape 關閉並還原投稿按鈕焦點。

Console 曾出現 iframe MutationObserver 訊息；在不含任何產品 JavaScript、只載入相同 fixture iframe 的診斷頁亦重現，與本次網站 observer 參數無關。此工具／fixture 訊息已記錄，沒有框架錯誤遮罩；正式 X console 仍待 staging 驗收。

上述測試降低手機跳回起點及換批競態風險，修正信心度約 98%；真實 X iframe、行動裝置網址列、staging 延遲及 IAM／CDN 仍待上線環境驗證。這是響應式模擬，不宣稱真實 iPhone／WebKit 驗收。

## 發布前條件

Staging 唯讀 inventory 尚無 dedicated UBLA／PAP snapshot bucket、Cloud Tasks API 啟用及新版 worker。已準備 private resource／IAM／回填／bootstrap 工具，apply 沿用既有 Owner Password-session 與 audit，不能用 ADC 或 Owner UID 代替登入。短效 token 只在記憶體／child stdin，不貼聊天或存檔。

完成 staging resource provision、backend、索引 READY、TTL ACTIVE、排序鍵回填及 fresh 快照後，再切換 Rules／preview Hosting，量測真實延遲、回應大小、CDN 與計費運算時間。正式發布另需乾淨提交、annotated release tag、live baseline、maintenance 及成功 final backup。操作順序見 [發布手冊](public-delivery-release.md)。第一次 staging Owner 登入尚未取得有效 session，未執行 setup；已提供預填帳戶與安全錯誤代碼的重試頁。目前沒有遠端部署或資料異動。

## Out-of-Scope

投稿視窗／教學、歷史／搜尋／分頁、X 嵌入裁切、每日配額／審核政策、CAPTCHA／付費 WAF、外部瀏覽器／真機自動測試、應用程式費用通知與自動停站。
