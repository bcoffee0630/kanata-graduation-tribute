# 六篇回憶牆與近即時留言發布

回憶牆固定 compact，最多「最新兩篇＋隨機四篇」，訪客手動刷新只讀共用快照。留言使用事件驅動快照與小型版本檢查，健康暖機目標為約 3–8 秒。每月 NT$500 是營運目標；正常超額照常服務，Cloud Billing 預算與通知由使用者管理。

本次沒有應用程式費用通知、費用門檻、Billing Pub/Sub、自動降級、停止投稿或自動停站。上一版僅存在於本機的費用保護已撤回，不需要建立或清除遠端 Billing 資源。原始 Firestore 讀取權限、登入、每日配額、帳號限制、審核、維護鎖與 release guards 保留。

## 私有來源與公開介面

`system/publicContentRevision` 的內容 revision 與投稿／治理寫入同一交易。私有事件觸發 Cloud Tasks，約兩秒合併窗口、單一並行及有限三次嘗試；發布途中有新 revision 必須接續處理。每分鐘 watchdog 補失敗工作，並判斷每五分鐘的八組樣本輪替。所有 immutable 快照上傳完成後才能 CAS 切換 pointer；舊工作不能覆蓋新版。

內容異動的 `revision` 與抽樣／artifact `version` 分開。五分鐘輪替可產生新 version，但來源內容未變時 revision 保持不變。Manifest 與內容回應的 revision 從同一已讀 pointer 取得，不增加 Firestore 或 Storage 查詢；畫廊以 revision 增加判斷更新提示，同 revision 輪替只淘汰舊候選／lease 並保留目前卡片。舊 server 缺少 revision 時保留 version 相容行為；409 使用中性的回憶牆已更新文案。

留言最多 100 則，revision 未變時重用；長期沒有新留言時，每十二小時只在 Storage 複製目前內容，避免一天的 artifact 清理期限刪除仍使用中的版本，不重新讀取留言來源。回憶牆最新兩篇使用索引，其餘候選使用固定 sampleKey、隨機起點、limit(6) 及有限回繞，排除最新兩篇後選四篇。禁止全表洗牌、offset 與公開要求生成。版本相同且伺服器重新核實來源 revision 才能續發 lease；本地換組不能延長期限。

公開 reader 使用獨立服務帳號，只能讀私人 bucket 的 `public-snapshots/` prefix，不能讀 Firestore 或舊媒體。快取故障只回暫時不可用，不回查來源。

發布前的 IAM 證明使用服務支援的 policy target。Firestore 在 project／父層核對完整 binding 與 permission／membership，拒絕所有潛在讀取授權，包含資料庫條件授權；不只採整體拒絕 enum。Storage 在 bucket 上核對完整 v3 allow 矩陣、etagged bucket policy 與實際 get-only 角色，僅允許唯一完全一致的固定 prefix 條件；未知資訊、額外授權及不完整矩陣一律停止。Prefix 內有效讀取另外要求三個真正 reader API 成功回傳 fresh 快照。不能把條件未知結果改稱可讀，也不能忽略失敗的驗證 API 或擴大驗證帳號權限。[Firestore 資料庫 IAM](https://firebase.google.com/docs/firestore/manage-databases#configure-per-database-access-permissions)、[Policy Troubleshooter v3](https://docs.cloud.google.com/policy-intelligence/docs/reference/policytroubleshooter/rest/v3/iam/troubleshoot)

| 介面 | 行為 |
|---|---|
| `/api/feed/version` | 留言與回憶牆的 version、revision、generatedAt、confirmedAt、validUntil；origin/CDN 各一秒快取 |
| `/api/messages` | 最多 100 則安全公開留言、revision、版本及 lease |
| `/api/gallery/batches/{0..7}` | 最多六篇、latestIds、revision、版本及 lease |

內容介面僅允許選填 `?version=<current-numeric-version>`；未知版本回 409，非法參數或 batch 不讀任意 Storage key。每服務 maxInstances=1，固定 key 快取與 single-flight，實例來源 token bucket 為持續 100 requests/s、burst 200。這限制來源放大，並非帳單硬封頂。

前端只在相關區段可見且分頁前景時，用一個 watcher 每兩秒檢查版本；失敗指數退避至最多 60 秒。Watcher 不因同版本重新下載內容。手動刷新每滾動 60 秒五次網路請求，失敗也計次、跨分頁共享；有效本地候選最多 48 篇。新版通知立即淘汰舊候選，但不替換正在閱讀的卡片。到期不得重新抽樣或循環舊留言，已開啟內容仍可閱讀。成功刷新只有非空清單才定位第一篇；空清單維持捲動位置。

公開根頁 `/` HTML 採 no-cache，使重新開啟網站能取得最新前端；這項調整不改公開 API 的 origin／CDN 一秒快取，也不改 admin 設定。

投稿／檢舉在昂貴 X 驗證之前限制每帳戶每端點五次／分鐘，額度查詢二十次／分鐘；不影響管理員治理或既有每日配額。callable 保留 `{id}` 並提供安全 `item`，自己的投稿／留言立即顯示，不新增客戶端原始資料讀取。

## 本機、staging 與正式發布

所有瀏覽器互動驗證只使用 Codex 內的 [@Browser](plugin://browser@openai-bundled)。桌面／手機 viewport 為響應式模擬，不宣稱完成 iPhone／WebKit 真機驗收，也不執行獨立 headless 或外部瀏覽器。單元、規則與 emulator integration 測試可用 CLI。

1. Node.js 22 下執行 `npm run build`、`npm run test:functions`、`npm run test:build`、`npm run test:rules`、`npm run test:integration`、兩種 Hosting build。Browser 驗證六篇上限、捲動／重排、刷新成敗、重疊 iframe、自己投稿競態、限流、三語、鍵盤／彈窗與留言增量更新。不要以本次舊四篇版 E2E 結果代表新版已驗收。
2. Staging 先用 `npm run setup:public-snapshots -- --project kanata-memorial-admin --bucket kanata-memorial-admin-public-snapshots` dry-run；Owner 授權 apply 只準備獨立 `asia-east1` UBLA／PAP bucket 與 Cloud Tasks API，再執行 provision 建立 dedicated reader、writer IAM 與 queue；不修改舊媒體 bucket。Provision 在任何 IAM 寫入前核實／啟用 Policy Troubleshooter API，供後續權限驗證。新角色傳播尚未完成時，只對已知 snapshot 角色的不存在錯誤有限重試 bucket IAM：最多八次、總時間最多 180 秒，保留相同 policy 與 etag；其他錯誤及 etag 衝突立即停止。設定 Functions 私人環境參數後，才使用 `npm run deploy:preview -- --project kanata-memorial-admin --phase backend` 部署新版 Functions／indexes。等待索引 READY 與 `publicSnapshotCycles.expiresAt`／`publicEndpointLimits.expiresAt` TTL 為 ACTIVE，先以唯讀 verifier 核實 actual worker identity、queue、private invoker 與 reader 隔離；只有確有缺少的已授權設定才再次 provision apply，不因通用 dry-run 計劃文字重複登入。
3. Provision、回填及 bootstrap 先 dry-run。Apply 必須使用該專案既有 Owner 的 Password session，短效 token 只透過 hidden TTY／stdin 保留於記憶體，不能貼到聊天、命令參數、環境變數、檔案或 history。沿用 [Owner 授權交接](x-gallery-release.md#owner-匯入操作)。ADC 或 Owner UID 不能替代實際 Owner session。
4. `backfill-public-gallery-sample-keys.mjs` bounded 回填舊公開 X 投稿排序鍵，不刪除既有投稿／媒體；零篇來源不需要空回填 apply。需要生成第一份快照時，使用 `bootstrap-public-snapshots.mjs --writer-service-account <actual-runtime-SA>`。ADC 為人類帳號時需要此 identity 供 Cloud Tasks OIDC 使用；先比對 deployed worker，不推測或改用 reader。若既有 private invoker 已實證有效、worker／watchdog 已產生 fresh 快照，且完整 verifier 與三個真正 reader fresh 200 均通過，不需為冗餘 bootstrap 再要求 Owner 登入。這不免除任何實際寫入所需的 Owner／revocation／audit／maintenance guards。驗證原始資料 client deny、reader inherited Firestore get/list deny、prefix 外與舊媒體 deny、私人 bucket 無公開下載 token、API 可讀及 lease 新鮮。
5. Staging 使用 `--phase release` 切換 Rules／preview Hosting，透過 @Browser 驗證真實嵌入與近即時更新。量測回應大小、CDN cache headers／命中率、publisher 原始查詢量及 Functions 計費時間；冷啟動／重試延遲另記錄。Staging 不具社群 OAuth 時，以 emulator 驗證登入投稿，不擅改 production OAuth。
6. 正式發布沿用 [增量發布](x-gallery-release.md#production-最小發布順序)：乾淨 HEAD、annotated `governance-production-YYYYMMDDTHHMMSSZ` tag、Gitleaks、目前 live baseline、維護鎖及成功 final backup。先完成私人資源、索引、排序鍵與 fresh 快照，再切換公開讀取 Rules 與前端；backend verifier 必須確認 reader identity／IAM／新 API，不得跳過保障。
7. 發布後驗證正常投稿、檢舉、管理員入口、六篇版面、版本更新及 Hosting no-cache 標頭。所有流程不要求費用初始化／人工恢復，也不因當月成本超過 NT$500 而中止。

Provision 完成後，Functions 私人環境參數只含此架構所需值（另保留原治理設定）：

```dotenv
PUBLIC_FEED_SERVICE_ACCOUNT=<dedicated-reader>@<project>.iam.gserviceaccount.com
PUBLIC_SNAPSHOT_BUCKET=<independent-private-bucket>
```

worker queue 的名稱、invoker 與 runtime identity 必須以實際部署回讀核實。不能只根據命名推斷帳號，也不能為了部署成功放寬成 public invoker。

## 本次 staging 狀態（2026-10-07）

實際 Owner setup／provision 已完成，backend 驗證確認 28 個 Functions ACTIVE、13 個 indexes READY、兩個 TTL ACTIVE；私人 queue 為 RUNNING，0.5 dispatch/s、單一並行、最多三次嘗試。完整 reader Firestore／Storage IAM 證明與三個 fresh API 200 通過。既有 private invoker 有效且 watchdog 已產生新鮮快照，因此未執行冗餘 Owner bootstrap。Queue create 的 POST 400 schema 問題已修正並通過實際 provision；首次 Eventarc managed agent 傳播問題經目標部署重試解決，未新增權限。

Rules 與 [preview Hosting](https://kanata-memorial-admin--admin-governance-bxf8cd81.web.app/) 已發布。Functions 101 tests、build／前端 142 tests、TypeScript build 與 Gitleaks dir 通過；本次原始投稿來源為零篇。Commit `4610994` 的三個 reader 與 Hosting 更新成功，最新 Browser 驗證手機／桌面空清單刷新不捲動、三語文字、視窗高度變化與無水平溢出；實際五分鐘輪替 version 改變、revision 維持 0，沒有錯誤更新提示且位置不變。Console 無 warn／error。

不能以 staging 零篇來源或本機 fixture 宣稱此環境的真實 X、新事件 3–8 秒延遲、CDN 命中率或計費運算時間已通過。實測回應大小與快取標頭見 [驗證紀錄](public-delivery-validation.md)，空資料不能代表正式六篇傳輸量；production 的七篇來源驗證另列於下。

## 本次 production 狀態（2026-10-07）

正式 release 使用 clean HEAD `6779976d00ff30acd51920c7ddfc59688e97aa9c` 與 annotated tag `governance-production-20261006T220114Z`。Baseline 為 `.production-backups/baseline-20261006T220128Z.json`，前版 live version `8bf6bc1ff95aeb12`、前版 tag `governance-production-20261004T194403Z`。Final backup `.production-backups/20261006T220711Z-final.json` 為 SUCCESSFUL，UTC 2026-10-06 22:08:03.759 完成。實際 Owner prepare／backfill 均成功；post-backfill dry-run scanned 7、candidates 0、finished true，worker／watchdog fresh 快照為 gallery revision 1／messages revision 0。

UTC 22:24:40 最終 verifier `.production-backups/backend-verification-20261006T222440Z.json` 通過 28 Functions ACTIVE、13 indexes READY、兩個 TTL ACTIVE 及完整 infrastructure／reader IAM 證明，`repaired: []`。最終 Rules／admin governance 已部署，public release session 67762 exit 0、Hosting 發布成功且 `maintenanceEnabled: false`，正式公開服務已離開 maintenance。

發布前 production preview 已用七篇真實 X 來源驗證最多六張、獨立比對 latest2、六個 widget 載入、匿名成功刷新定位第一張及重疊 widget 保留；手機只改高度不跳、切換繁中不重掛載、桌面三欄無溢出，console warn／error 為零。17 次 GET 與八組六篇 schema／去重／latest2 檢查全部通過，公開 API 一秒快取維持。數值與證據見 [驗證紀錄](public-delivery-validation.md)。

Final live [公開主站](https://kanata-memorial.web.app/) 已用 Codex @Browser 驗證六個真實 X widgets、獨立 latest2、三語、桌面三欄、手機 height-only 變更位置不跳，以及匿名刷新後五個重疊 widgets 保留、第一張定位正確；console warn／error 為零。桌面語系切換的說明換行造成約 40px 位置變化，未跳回起點，不宣稱所有語系切換零位移。實測數字與截圖記錄見 [驗證紀錄](public-delivery-validation.md)。

正式 live HTTP／Rules 檢查於 UTC 22:27:09 及兩項修正 probe 的 22:29:06 通過，sanitized manifest 為 `.production-backups/final-live-20261006T222906Z.json`。Public version `224b84e215741df3`（22:24:48.769 發布）、admin version `faeee9014835b330`（22:23:54.257 發布）均已回讀。`eienkanata.com`／public web.app 的根頁 no-cache、三個 API fresh 200／一秒快取、admin 兩域 no-store、原始 fanart／messages 匿名 get／list 403 均通過，maintenance 為 false。

正式 [回憶牆](https://eienkanata.com/#gallery-section) 已用 Codex @Browser 確認六個真實 X 嵌入、最新兩篇、匿名刷新、三語、手機閱讀位置與 height-only viewport 變化；一般視窗已恢復並保留分頁。原始 baseline、final backup、backend verifier 與 live manifest 合併參照於 `.production-backups/governance-production-20261006T220114Z-memory-wall-release.json`。

真機、新投稿事件 3–8 秒更新、CDN 命中率及計費運算時間仍未量測；失敗／人工增高案例保留既有 fixture 證據，不在 production 造故障。所有 Owner／維護／備份／發布 guards 與 Out-of-Scope 維持，不新增費用 gate。

## 成本評估與回滾

Firestore 每專案第一個建立的合資格資料庫（不論資料庫 ID）每日有 50,000 次免費文件讀取，同一資料庫的全站工作共用此額度。八組輪替每天 288 次，正常回憶牆輪替來源讀取最多約 17,856 次／日；每日二十則留言、每次最多 100 來源文件，示例合計約兩萬次，另計新 X 投稿／審核異動觸發的重建、治理、revision／協調及重試。每次回憶牆重建最多八組各六候選加 bounded 最新候選，約最多 62 次計費來源讀取（含空查詢最低計費）；事件驅動重建不僅限於五分鐘輪替。訪客讀取不會新增原始抽樣。費率依 account／region 與當時官方資訊核實。[Firestore 計價](https://firebase.google.com/docs/firestore/pricing#free_quota)

Hosting 免費傳輸 10 GB／月，CDN 命中仍計傳輸。費用還包含 Functions active CPU／memory、requests、Storage operations 與 Cloud Tasks；Scheduler、Eventarc、Cloud Build／Artifact Registry 也可能另計費，不能只用 Firestore 免費額度判定整站費用。大量惡意請求仍可能產生請求、運算及傳輸費用；不承諾 NT$500 硬封頂。[Hosting 計價](https://firebase.google.com/docs/hosting/usage-quotas-pricing)、[Cloud Run 計價](https://cloud.google.com/run/pricing)、[Storage 計價](https://cloud.google.com/storage/pricing)、[Cloud Tasks 計價](https://cloud.google.com/tasks/pricing)

回滾先開 maintenance，保留新增投稿、治理決議與 audit。可切回相容快照 API 的前一個已驗證版本；原始公開 Firestore deny 保留。不得恢復舊直接 listener 並放寬 Rules，也不得把撤回的費用停用邏輯當成回滾必要條件。只有實際資料損壞才按既有備份流程還原，不刪既有投稿或媒體。

## Out-of-Scope

不調整投稿視窗／教學、不新增歷史／搜尋／分頁、不裁切 X 嵌入、不改每日配額／審核政策、不加 CAPTCHA／付費 WAF、不執行外部瀏覽器／真機自動測試，不建立應用程式費用通知或自動停站。Cloud Billing 預算通知由使用者管理。
