# 六篇回憶牆與近即時留言發布

回憶牆固定 compact，最多「最新兩篇＋隨機四篇」，訪客手動刷新只讀共用快照。留言使用事件驅動快照與小型版本檢查，健康暖機目標為約 3–8 秒。每月 NT$500 是營運目標；正常超額照常服務，Cloud Billing 預算與通知由使用者管理。

本次沒有應用程式費用通知、費用門檻、Billing Pub/Sub、自動降級、停止投稿或自動停站。上一版僅存在於本機的費用保護已撤回，不需要建立或清除遠端 Billing 資源。原始 Firestore 讀取權限、登入、每日配額、帳號限制、審核、維護鎖與 release guards 保留。

## 私有來源與公開介面

`system/publicContentRevision` 的內容 revision 與投稿／治理寫入同一交易。私有事件觸發 Cloud Tasks，約兩秒合併窗口、單一並行及有限三次嘗試；發布途中有新 revision 必須接續處理。每分鐘 watchdog 補失敗工作，並判斷每五分鐘的八組樣本輪替。所有 immutable 快照上傳完成後才能 CAS 切換 pointer；舊工作不能覆蓋新版。

留言最多 100 則，revision 未變時重用；長期沒有新留言時，每十二小時只在 Storage 複製目前內容，避免一天的 artifact 清理期限刪除仍使用中的版本，不重新讀取留言來源。回憶牆最新兩篇使用索引，其餘候選使用固定 sampleKey、隨機起點、limit(6) 及有限回繞，排除最新兩篇後選四篇。禁止全表洗牌、offset 與公開要求生成。版本相同且伺服器重新核實來源 revision 才能續發 lease；本地換組不能延長期限。

公開 reader 使用獨立服務帳號，只能讀私人 bucket 的 `public-snapshots/` prefix，不能讀 Firestore 或舊媒體。快取故障只回暫時不可用，不回查來源。

| 介面 | 行為 |
|---|---|
| `/api/feed/version` | 留言與回憶牆的 version、generatedAt、confirmedAt、validUntil；origin/CDN 各一秒快取 |
| `/api/messages` | 最多 100 則安全公開留言 |
| `/api/gallery/batches/{0..7}` | 最多六篇、latestIds、版本及 lease |

內容介面僅允許選填 `?version=<current-numeric-version>`；未知版本回 409，非法參數或 batch 不讀任意 Storage key。每服務 maxInstances=1，固定 key 快取與 single-flight，實例來源 token bucket 為持續 100 requests/s、burst 200。這限制來源放大，並非帳單硬封頂。

前端只在相關區段可見且分頁前景時，用一個 watcher 每兩秒檢查版本；失敗指數退避至最多 60 秒。同版本不重新下載內容。手動刷新每滾動 60 秒五次網路請求，失敗也計次、跨分頁共享；有效本地候選最多 48 篇。新版通知立即淘汰舊候選，但不替換正在閱讀的卡片。到期不得重新抽樣或循環舊留言，已開啟內容仍可閱讀。

投稿／檢舉在昂貴 X 驗證之前限制每帳戶每端點五次／分鐘，額度查詢二十次／分鐘；不影響管理員治理或既有每日配額。callable 保留 `{id}` 並提供安全 `item`，自己的投稿／留言立即顯示，不新增客戶端原始資料讀取。

## 本機、staging 與正式發布

所有瀏覽器互動驗證只使用 Codex 內的 [@Browser](plugin://browser@openai-bundled)。桌面／手機 viewport 為響應式模擬，不宣稱完成 iPhone／WebKit 真機驗收，也不執行獨立 headless 或外部瀏覽器。單元、規則與 emulator integration 測試可用 CLI。

1. Node.js 22 下執行 `npm run build`、`npm run test:functions`、`npm run test:build`、`npm run test:rules`、`npm run test:integration`、兩種 Hosting build。Browser 驗證六篇上限、捲動／重排、刷新成敗、重疊 iframe、自己投稿競態、限流、三語、鍵盤／彈窗與留言增量更新。不要以本次舊四篇版 E2E 結果代表新版已驗收。
2. Staging 先用 `npm run setup:public-snapshots -- --project kanata-memorial-admin --bucket kanata-memorial-admin-public-snapshots` dry-run；Owner 授權 apply 只準備獨立 `asia-east1` UBLA／PAP bucket 與 Cloud Tasks API，再執行 provision 建立 dedicated reader、writer IAM 與 queue；不修改舊媒體 bucket。設定 Functions 私人環境參數後，才使用 `npm run deploy:preview -- --project kanata-memorial-admin --phase backend` 部署新版 Functions／indexes。等待索引 READY 與 `publicSnapshotCycles.expiresAt`／`publicEndpointLimits.expiresAt` TTL 為 ACTIVE，再重跑 provision 核實實際 worker identity 並補齊 private invoker。
3. Provision、回填及 bootstrap 先 dry-run。Apply 必須使用該專案既有 Owner 的 Password session，短效 token 只透過 hidden TTY／stdin 保留於記憶體，不能貼到聊天、命令參數、環境變數、檔案或 history。沿用 [Owner 授權交接](x-gallery-release.md#owner-匯入操作)。ADC 或 Owner UID 不能替代實際 Owner session。
4. `backfill-public-gallery-sample-keys.mjs` bounded 回填舊公開 X 投稿排序鍵，不刪除既有投稿／媒體；`bootstrap-public-snapshots.mjs --writer-service-account <actual-runtime-SA>` 私人生成第一份快照。ADC 為人類帳號時需要此 identity 供 Cloud Tasks OIDC 使用；先比對 deployed worker，不推測或改用 reader。驗證原始資料 client deny、reader inherited Firestore get/list deny、prefix 外與舊媒體 deny、私人 bucket 無公開下載 token、API 可讀及 lease 新鮮。
5. Staging 使用 `--phase release` 切換 Rules／preview Hosting，透過 @Browser 驗證真實嵌入與近即時更新。量測回應大小、CDN cache headers／命中率、publisher 原始查詢量及 Functions 計費時間；冷啟動／重試延遲另記錄。Staging 不具社群 OAuth 時，以 emulator 驗證登入投稿，不擅改 production OAuth。
6. 正式發布沿用 [增量發布](x-gallery-release.md#production-最小發布順序)：乾淨 HEAD、annotated `governance-production-YYYYMMDDTHHMMSSZ` tag、Gitleaks、目前 live baseline、維護鎖及成功 final backup。先完成私人資源、索引、排序鍵與 fresh 快照，再切換公開讀取 Rules 與前端；backend verifier 必須確認 reader identity／IAM／新 API，不得跳過保障。
7. 發布後驗證正常投稿、檢舉、管理員入口、六篇版面、版本更新及 Hosting no-cache 標頭。所有流程不要求費用初始化／人工恢復，也不因當月成本超過 NT$500 而中止。

Provision 完成後，Functions 私人環境參數只含此架構所需值（另保留原治理設定）：

```dotenv
PUBLIC_FEED_SERVICE_ACCOUNT=<dedicated-reader>@<project>.iam.gserviceaccount.com
PUBLIC_SNAPSHOT_BUCKET=<independent-private-bucket>
```

worker queue 的名稱、invoker 與 runtime identity 必須以實際部署回讀核實。不能只根據命名推斷帳號，也不能為了部署成功放寬成 public invoker。

## 成本評估與回滾

Firestore 每專案第一個建立的合資格資料庫（不論資料庫 ID）每日有 50,000 次免費文件讀取，同一資料庫的全站工作共用此額度。八組輪替每天 288 次，正常回憶牆輪替來源讀取最多約 17,856 次／日；每日二十則留言、每次最多 100 來源文件，示例合計約兩萬次，另計新 X 投稿／審核異動觸發的重建、治理、revision／協調及重試。每次回憶牆重建最多八組各六候選加 bounded 最新候選，約最多 62 次計費來源讀取（含空查詢最低計費）；事件驅動重建不僅限於五分鐘輪替。訪客讀取不會新增原始抽樣。費率依 account／region 與當時官方資訊核實。[Firestore 計價](https://firebase.google.com/docs/firestore/pricing#free_quota)

Hosting 免費傳輸 10 GB／月，CDN 命中仍計傳輸。費用還包含 Functions active CPU／memory、requests、Storage operations 與 Cloud Tasks；Scheduler、Eventarc、Cloud Build／Artifact Registry 也可能另計費，不能只用 Firestore 免費額度判定整站費用。大量惡意請求仍可能產生請求、運算及傳輸費用；不承諾 NT$500 硬封頂。[Hosting 計價](https://firebase.google.com/docs/hosting/usage-quotas-pricing)、[Cloud Run 計價](https://cloud.google.com/run/pricing)、[Storage 計價](https://cloud.google.com/storage/pricing)、[Cloud Tasks 計價](https://cloud.google.com/tasks/pricing)

回滾先開 maintenance，保留新增投稿、治理決議與 audit。可切回相容快照 API 的前一個已驗證版本；原始公開 Firestore deny 保留。不得恢復舊直接 listener 並放寬 Rules，也不得把撤回的費用停用邏輯當成回滾必要條件。只有實際資料損壞才按既有備份流程還原，不刪既有投稿或媒體。

## Out-of-Scope

不調整投稿視窗／教學、不新增歷史／搜尋／分頁、不裁切 X 嵌入、不改每日配額／審核政策、不加 CAPTCHA／付費 WAF、不執行外部瀏覽器／真機自動測試，不建立應用程式費用通知或自動停站。Cloud Billing 預算通知由使用者管理。
