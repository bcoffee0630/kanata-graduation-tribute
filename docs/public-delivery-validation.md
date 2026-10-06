# 六篇回憶牆與近即時留言驗證紀錄

驗證日期：2026-10-07（Asia/Taipei）。本次結果取代先前四篇版紀錄。Staging 已完成實際 Owner setup／provision、backend／索引／TTL 與 Rules／preview 發布，reader IAM 證明及三個 fresh API 200 均通過；production 未變更。最新修正 commit `4610994` 的三個 reader 與 preview Hosting 均已部署，最新 Browser 響應式驗證如下。

Staging 來源目前為零篇投稿。已有私人 queue 與新鮮快照的實際驗證，尚未驗證真實 X 嵌入、真實新事件的 3–8 秒更新目標、CDN 命中率或計費運算時間。空快照回應大小不能代表六篇內容的傳輸量。

## 已完成

- 固定 compact、最多最新兩篇＋隨機四篇，移除尺寸偏好、尺寸切換／提示與兩個浮動畫廊按鈕。名稱及說明依使用者指定更新三語。
- 原投稿位置保留，旁邊新增不需登入的刷新；兩個操作觸控目標至少 44px。返回頂部保留三語 tooltip，彈窗開啟時隱藏並退出焦點入口。
- 整個換批、自己投稿插入與重排保護高度；視窗只改高度不重排。重疊 X 投稿保留 iframe，失敗保留卡片／位置，非空刷新成功在仍閱讀區段且未開啟彈窗時定位第一篇；空清單刷新沒有定位目標，保留捲動位置。
- 自己的安全公開 item 立即置頂，最多六篇；較早刷新回應不能覆蓋新投稿。偵測其他人新內容只提示；主動刷新恢復最新兩篇＋隨機四篇。
- 手動網路刷新每滾動六十秒五次，失敗也計次；跨分頁額度共享，儲存受限有 fallback。本地候選最多 48 篇，版本更新清除舊候選，換組不能續期，過期不能重新抽樣。
- 留言增量加入下一個可用軌道；保留剩餘播放佇列、既有動畫與已開啟內容。自己的留言立即加入，暫停／背景維持暫停；期限到後停止重新循環。
- 私有 revision／約兩秒合併的 Cloud Tasks worker、三次重試、一分鐘 watchdog、五分鐘八組輪替、bounded 查詢與 CAS 發布。留言 revision 不變不重查；十二小時 artifact 複製只用 Storage。
- 共用前景／可見區段版本檢查器，每兩秒檢查，失敗退避至六十秒。公開 reader 不具 Firestore 權限，只讀固定快照 key，maxInstances=1、single-flight 與實例 100/s、burst 200 限流。
- Manifest 與內容回應攜帶同一 pointer 的安全非負整數 `revision`，不增加查詢。畫廊以來源 revision 判斷更新提示；五分鐘 sample version 輪替仍淘汰舊候選／lease，但 revision 未增加時不提示內容更新。舊 API 缺少 revision 時保留 version 相容行為，409 提示改為中性的回憶牆更新文案。
- 畫廊狀態保存翻譯 key，語言載入／切換後重新翻譯，不重新取得內容或重建重疊 iframe；首次成功載入空清單不顯示重複組合提示。
- 投稿／檢舉每帳戶每端點五次／分鐘，額度查詢二十次／分鐘；既有登入、每日配額、帳號限制、管理員治理及維護鎖保留。
- 已移除本機上一版 Budget Pub/Sub、費用門檻、成本初始化／恢復工具、control.json 及投稿／檢舉 cost gate。NT$500 超額不影響正常操作；Cloud Billing 通知由使用者管理。

## CLI 測試

| 範圍 | 結果 |
|---|---|
| TypeScript build | 通過 |
| Preview／public／admin／maintenance Hosting build | 通過 |
| Functions unit tests | 101 通過 |
| 前端 VM、建置／發布工具 tests | 142 通過 |
| 正常／維護 Firestore 與 Storage Rules | 14 通過 |
| Firebase emulator integration tests | 28 通過 |
| Gitleaks 工作目錄／全部 Git 歷史、diff whitespace | 通過 |

前端 VM 測試不開啟瀏覽器，涵蓋延遲回應、版本淘汰／續期、自己投稿競態、限流／跨分頁、儲存失效、快取到期、留言增量／暫停／背景、過期自己的內容與退避。後端涵蓋事件重送、窗口尾端、發布失敗、CAS 競態、watchdog、來源 revision 回退、訪客讀取不增加來源抽樣，以及安全 callable item／連點限制。TTL release verifier 要求遠端兩個 expiresAt 政策為 ACTIVE。

最新畫廊／共用 feed 的 focused VM 套件共 38 tests 通過，包含 revision 0→0 輪替不提示、0→1 提示、接受新版後同 revision 再輪替仍安靜、舊 API 相容、無效 revision 拒絕、語言載入競態及使用實際 `scrollToFirst()` 的零篇刷新不捲動；不以 VM 結果代替最新版 Browser 驗收。

Provision 新測試涵蓋實際角色不存在回應、已知角色限定、八次／180 秒上限、etag 衝突與其他錯誤停止，以及 API 啟用失敗禁止 IAM 寫入。Owner audit 必須先於 API 啟用及 IAM；mock HTTP 測試確認 dry-run 不寫入、已存在 reader／roles 重用。所有測試不存取遠端或登入。

REST 契約測試依官方定義拒絕 queue wrapper 及服務帳號 IAM 查詢的錯誤 body，驗證建立／更新 URL、updateMask、空 POST body、policy version 3、etag 與既有條件保留。

IAM 證明測試涵蓋完整 policy／explanation 一對一匹配、父層與條件授權、未知權限／membership、矩陣遺漏或衝突、額外讀取／寫入角色及 deny／錯誤拒絕。不將 UNKNOWN_CONDITIONAL 當成實際可讀，也不因整體 NOT_GRANTED 忽略可能生效的資料庫條件授權。

更新的 Playwright E2E 檔案保留作為測試規格，**本次不執行**；不以舊四篇版或外部瀏覽器結果代表本次通過。

## Codex Browser 響應式驗證

以下為非空資料的完整 fixture 互動驗證；最後新增的 revision／零篇刷新修正另以 VM 與下列 staging 驗證覆蓋。全部互動測試使用 [@Browser](plugin://browser@openai-bundled)，沒有啟動外部或獨立 headless 瀏覽器。網址 `http://127.0.0.1:5188/`，載入實際前端程式；測試工具只存在 `/tmp`，快照 API／X iframe 與登入是本機 fixture，不會發布，也不寫遠端資料。

- 桌面 1440×1000／900×900，手機 393×852／393×720；桌面三欄、窄手機一欄 compact，沒有水平溢出。
- 0／1／6／7／14 篇來源分別顯示 0／1／6／6／6；不足六篇顯示實際數量。
- 桌面嵌入高度及視窗高度變化未跳回起點。手機複查找到捲動錨定造成的重排位移，已停用該區段 overflow-anchor 並保留量測時的格線位置。實際 393×720、閱讀第 3 張時，六個 iframe 連續三次各增加 80px：scrollY 始終 2101，Grid 每次增高 480px，第 3 張只自然下移 160px；720→852 高度變更也維持 scrollY。原生座標點擊排除 locator 自動捲動干擾。
- 刷新成功定位第一張，重疊最新投稿的 iframe 實例 ID 保留；API 失敗案例 scrollY 1323.5 前後一致，原六張卡片保留。
- 自己投稿在第一張、總數六張，其餘五張 iframe 保留。刷新等待中的自己投稿不被覆蓋；另有 VM deferred-request 競態測試。
- 暫停留言時自己的新留言不播放，恢復後優先出現；fixture 新共用留言約 1.1 秒後顯示。此數字只驗證前端，不代表 staging 3–8 秒目標已通過。
- 繁中／日文／英文名稱、說明與刷新文案已驗證。模擬登入後分享彈窗可開啟、初始焦點正確，返回頂部隱藏；Escape 關閉並還原投稿按鈕焦點。

Console 曾出現 iframe MutationObserver 訊息；在不含任何產品 JavaScript、只載入相同 fixture iframe 的診斷頁亦重現，與本次網站 observer 參數無關。此工具／fixture 訊息已記錄，沒有框架錯誤遮罩；正式 X console 仍待 staging 驗收。

上述 fixture 測試降低手機跳回起點及換批競態風險，修正信心度約 98%；真實 X iframe、行動裝置網址列、staging 新事件延遲及 CDN 仍待驗證。這是響應式模擬，不宣稱真實 iPhone／WebKit 驗收；staging 的實際 IAM 結果另列於下。

## Staging 已完成與待驗收

實際 Owner Password session 的 setup 與 provision 均回報 `completed: true`。獨立 snapshot bucket 的 UBLA／PAP、Cloud Tasks API、Policy Troubleshooter API、dedicated reader、四個固定 custom roles 與 bucket snapshot bindings 均已核實；bucket 無公開 IAM，舊媒體 bucket 未修改。

先前 queue POST 400 的 Queue body wrapper 已依官方 REST schema 修正，後續實際 provision 已成功；服務帳號 IAM 讀取也使用 policy version query 與空 POST body。新 custom role 傳播由限定角色／錯誤的有限重試處理。首次 Eventarc managed service agent 傳播問題經目標部署重試解決，沒有新增權限或放寬 guard。

完整 backend 驗證確認 28 個 Functions 為 ACTIVE、13 個 indexes 為 READY、`publicSnapshotCycles.expiresAt` 與 `publicEndpointLimits.expiresAt` 兩個 TTL 為 ACTIVE。私人 Cloud Tasks queue 為 RUNNING，限制為 0.5 dispatch/s、單一並行、最多三次嘗試。

Reader 的完整 Firestore／Storage IAM 證明已在 staging 唯讀實測通過：Firestore project／父層矩陣的 get／list 沒有任何潛在授權；Storage v3 bucket 矩陣、etagged policy 與實際 get-only role 對齊，唯一可能授權為固定 snapshot prefix。三個真正 reader API 均回傳 fresh 200，另行證明 prefix 內的實際讀取。沒有授予 TokenCreator 或新增驗證用權限。

已部署 worker 的既有 private invoker 經實證有效，watchdog 已產生新鮮快照，因此沒有為相同已完成狀態再次要求 Owner 登入或額外執行 bootstrap apply。Staging 排序鍵 dry-run 掃描零篇、候選零篇，不需要空回填 apply。所有需要寫入的工具仍保留實際 Owner Password session、revocation／身分核對、audit、etag、私人 prefix 與其他 release guards；ADC 或 Owner UID 不能替代登入，短效 token 只在記憶體／child stdin。

Rules 與 preview Hosting 已發布：[staging preview](https://kanata-memorial-admin--admin-governance-bxf8cd81.web.app/)。Commit `4610994` 的三個 reader 與 Hosting 更新均成功。實際重新載入確認 gallery v8、public-feed v7、i18n v7；手機 393×852、393×720 與桌面 1440×1000 無水平溢出。

- 未登入可刷新。手機原生點擊空清單刷新前後 scrollTop 均為 1313.5；桌面原生點擊前後均為 1620.5。獨立只改視窗高度 720→852 時 scrollTop 保持 1208.5；刷新按鈕為 98×47.6px。
- 首次空清單成功沒有重複組合狀態文字。手動刷新後的狀態與導覽、名稱、說明在繁中、日文與英文切換後正確翻譯；沒有錯誤遮罩，最新版 console warn／error 為零。
- 最新 API 檢查於 UTC 2026-10-06 21:56:42 通過：version 270 bytes、messages 134 bytes、八組 gallery 各 149 bytes，皆 revision 0、有效期限新鮮；均為未壓縮空資料 JSON 大小。非法 batch、任意參數及未知版本按預期拒絕，拒絕回應 no-store。正常 API 為 `public, max-age=0, s-maxage=1, must-revalidate`；沒有 Age 可據以估算 CDN 命中率。
- UTC 22:00:32 回讀確認五分鐘輪替將 gallery version 從 `1791323702542` 改為 `1791324002594`，revision 維持 0。Browser 的更新提示仍隱藏且文字為空，scrollTop 保持 1620.5；留言內容版本不變而 lease 已續發。
- 實際 HEAD 回讀 `/`、`/index.html`、gallery v8 與繁中 locale v7 均 200／no-cache；`/admin/` 為 200／no-store。公開 API 一秒快取維持。

來源為零篇，因此真實 X、新事件 3–8 秒更新、CDN 命中率及計費運算時間保持未驗收。正式發布仍需乾淨提交、annotated release tag、live baseline、maintenance 及成功 final backup；本次未變更 production。操作順序見 [發布手冊](public-delivery-release.md)。

## Out-of-Scope

投稿視窗／教學、歷史／搜尋／分頁、X 嵌入裁切、每日配額／審核政策、CAPTCHA／付費 WAF、外部瀏覽器／真機自動測試、應用程式費用通知與自動停站。
