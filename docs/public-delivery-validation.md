# 六篇回憶牆與近即時留言驗證紀錄

驗證日期：2026-10-07（Asia/Taipei）。本次結果取代先前四篇版紀錄。Staging 已完成實際 Owner setup／provision、backend／索引／TTL 與 Rules／preview 發布；production 已完成正式公開 release，maintenance 已解除，最終 backend verifier、live HTTP／Rules 與 Codex Browser 回讀均通過。下列分別記錄 fixture、staging、正式專案發布前 preview 與 final live 的證據。

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

Console 曾出現 iframe MutationObserver 訊息；在不含任何產品 JavaScript、只載入相同 fixture iframe 的診斷頁亦重現，與本次網站 observer 參數無關。此工具／fixture 訊息已記錄，沒有框架錯誤遮罩；正式專案 preview 的真實 X console 結果另列於下。

上述 fixture 測試降低手機跳回起點及換批競態風險，修正信心度約 98%；正式專案 preview 的真實 X iframe 已另行驗證。這是響應式模擬，不宣稱真實 iPhone／WebKit 或真機網址列驗收；真實新事件延遲及 CDN 命中率仍未量測。

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

Staging 來源為零篇，因此此環境的真實 X、新事件 3–8 秒更新、CDN 命中率及計費運算時間保持未驗收。Production 已按 release guards 發布，結果另列於下，不以 staging 空資料替代正式七篇來源驗證。操作順序見 [發布手冊](public-delivery-release.md)。

## Production 正式發布與 preview 實測（2026-10-07）

| 項目 | 確認結果 |
|---|---|
| Release HEAD／tag | `6779976d00ff30acd51920c7ddfc59688e97aa9c`／`governance-production-20261006T220114Z`；發布時 HEAD clean、annotated tag 相符 |
| 前版 baseline | `.production-backups/baseline-20261006T220128Z.json`；前版 live version `8bf6bc1ff95aeb12`、tag `governance-production-20261004T194403Z` |
| Final backup | `.production-backups/20261006T220711Z-final.json`，SUCCESSFUL，UTC 2026-10-06 22:08:03.759 完成 |
| Owner 作業 | `prepare-production` 與 backfill 均 `completed: true`；backfill 後 dry-run scanned 7、candidates 0、finished true，排序鍵已無待補候選 |
| 私人快照 | worker／watchdog 已產生 fresh 快照；gallery revision 1、messages revision 0；來源七篇 eligible X 投稿 |
| 最終 backend verifier | UTC 2026-10-06 22:24:40 通過，`.production-backups/backend-verification-20261006T222440Z.json`；28 Functions ACTIVE、13 indexes READY、兩個 TTL ACTIVE，完整 infrastructure／reader IAM 證明通過，`repaired: []` |
| 正式發布 | 最終 Rules＋admin governance 部署成功；public release session 67762 exit 0、public Hosting 成功，`maintenanceEnabled: false` |

最新兩篇以獨立來源資料核對為 `2107039903133692023`／`2106727069640237561`。正式專案的發布前 preview HTTP 共 17 次 GET 全部通過，八組 gallery 各六篇、無重複且 latest2 均符合此基準。實測未壓縮 JSON 為 version 270 bytes、gallery 1361 bytes、messages 613 bytes；公開 API 一秒快取，未提供 Age，不能據此宣稱 CDN 命中率。

正式專案發布前 preview 使用 Codex @Browser 載入真實 X，確認六個 widgets 成功：

- 桌面 1440×1000 切換手機 393×720；閱讀第 2 張時只把高度改為 852，scrollY 保持 2050、grid height 保持 3456，沒有跳回畫廊開始。
- 切換繁中前後 scrollY 保持 2220.5，六個 widget IDs 全部保留；不是重新掛載嵌入。
- 未登入原生刷新由六張換為六張，保留最新兩篇及其他重疊 widgets，僅新增一篇；第一張 top 60.21、scrollY 1427，定位至 navbar 下方。
- 繼續閱讀第 3–4 張、scrollY 2705，未跳回起點；返回桌面為三欄且無水平溢出。Console warn／error 均為零。

以上 Browser 與 17 GET 是發布前 preview 證據；final live 結果另列於下，不能互相替代。真機 iPhone／WebKit、新投稿事件的端到端 3–8 秒延遲、CDN 命中率及 Functions 計費運算時間仍未量測；API 失敗與人工 iframe 高度增長沿用 fixture 證據，沒有在 production 製造故障。

### Final live HTTP／Rules

UTC 2026-10-06 22:27:09 完成一次正式唯讀檢查，22:29:06 補驗兩個合法文件 ID 的匿名 GET；最終 `passed: true`，信心度 99%。證據為 `.production-backups/final-live-20261006T222906Z.json`。初次 GET probe 使用 Firestore 保留的 `__.*__` ID 而回 400，這是檢查工具錯誤；只補做受影響的兩項，不把 400 當作 Rules 拒絕。沒有寫入雲端、重新抽樣來源或擴大權限。

- [正式網站](https://eienkanata.com/) 與 `kanata-memorial.web.app` 的 `/`、`/index.html` 均 200／no-cache；自訂域名的 ownership、host 與 certificate 狀態已核實。
- 兩個公開域名的三個 API 均 fresh 200。Gallery 六篇、latest2／ID／postId 去重與安全 projection 通過；messages 兩篇、revision 0，gallery revision 1。Version／gallery／messages 分別為 270／1361／613 bytes，未壓縮；API cache 為 `public, max-age=0, s-maxage=1, must-revalidate`，nosniff 有效。當次 lease 有效至 UTC 22:32:02.226，沒有 Age，不據此推算命中率。
- `admin.eienkanata.com` 與 `eienkanata-admin.web.app` 的根頁及 `/auth/action/` 均 200／no-store。Maintenance 為 false；28 Functions ACTIVE，三個 reader 均使用指定私人 bucket／獨立帳號且 maxInstances 為 1。
- `fanart`／`messages` 的匿名 get／list 共四項均為 403／`RULES_DENIAL`，不是 API key 或其他驗證錯誤。Firestore ruleset 為 `02ddf661-6540-4fd9-bf89-32f2a2c3e28c`；既有 `kanata-memorial.firebasestorage.app` Storage ruleset 為 `3b85faed-0562-47a1-b711-e4926845e8e5`。
- Public live release 為 `1791325488769000`，version `224b84e215741df3`，UTC 22:24:48.769 發布；admin release 為 `1791325434257000`，version `faeee9014835b330`，UTC 22:23:54.257 發布。上述版本對應本次 release tag 的程式與 Hosting artifact；後續文件提交不改動部署內容。

### Final live Browser

公開主站 [kanata-memorial.web.app](https://kanata-memorial.web.app/) 已在 release 成功後使用 Codex @Browser 驗證：六個真實 X widgets 均成功，latest2 與上述獨立來源基準一致；實際載入 gallery v8／public-feed v7／i18n v7。

- 桌面 1440×1000 為三欄、沒有水平溢出。英文／日文／繁中文字正確，六個 widget IDs 全部保留。桌面語系切換時說明換行造成約 40px 的捲動位置變化，沒有跳回畫廊起點；不將此案例記成完全零位移。
- 手機 393×720 閱讀第 2–3 張，scrollY 2185.5、grid height 3456。寬度不變、只把高度改為 852 後，scrollY 與 grid height 完全相同，六個 iframe IDs 保留；原生繼續向下閱讀第 3–4 張，scrollY 2782。
- 底部原生點擊匿名刷新，按鈕 98×47.59375px；scrollY 4699→1427，第一張 top 60.2109。六張換為六張，五個重疊 widget IDs 保留，替換的一張建立新 widget；無登入要求，status／hint 為空。
- 最終 console warn／error 均為零。截圖位於 `/tmp/kanata-wall-production-live-desktop.jpg`、`/tmp/kanata-wall-production-live-mobile.jpg`、`/tmp/kanata-wall-production-live-mobile-reading.jpg`。

另直接開啟正式自訂網址 `https://eienkanata.com/#gallery-section`，一般視窗 1280×720 確認繁中名稱／說明、六張卡片及六個真實 iframe、最新兩篇一致、無水平溢出及 console warn／error。已恢復一般 viewport；截圖 `/tmp/kanata-wall-production-live.jpg`，分頁保留供使用者檢視。

此驗證為真實 X 的響應式 viewport 模擬，未宣稱真機、真實新投稿事件 3–8 秒、CDN 命中率或計費運算時間通過。

## Out-of-Scope

投稿視窗／教學、歷史／搜尋／分頁、X 嵌入裁切、每日配額／審核政策、CAPTCHA／付費 WAF、外部瀏覽器／真機自動測試、應用程式費用通知與自動停站。
