# X 回憶畫廊增量發布

本次沿用既有 production 治理後台。保留舊圖片閱讀、媒體代理、清理排程與管理紀錄；新的投稿入口只接受 X 公開貼文連結。

## 本機與 staging 驗證

使用可執行的 Node.js 22，依 lockfile 安裝兩層依賴，再執行 `npm test`、`npm run test:e2e`、`npm run build:hosting:production`。Firebase CLI、Java、Google Cloud CLI 與 Gitleaks 均沿用已安裝工具。若 Homebrew Node 因動態函式庫版本不匹配而無法啟動，修復該 Node 安裝並確認版本；不要偽造 dylib 版本 symlink。

本機 Homebrew shell 可先使用 `export PATH="/opt/homebrew/opt/node@22/bin:$PATH"`，再確認 `node --version` 為 22、`npm --version` 能正常執行；不需要把整台電腦的預設 Node 改版。

`npm run deploy:preview -- --project kanata-memorial-admin` 的 `admin-governance` channel 已包含公開站 `/` 與後台 `/admin/`；名稱不代表只能看後台。此腳本不發布 staging live，也拒絕 production project。公開的 `/__/firebase/init.json` 必須回 staging project。

Staging 文件尚未設定 Google/GitHub OAuth，因此完整社群登入、投稿與每日配額以 emulator 驗證；staging 檢查真實官方 X embed、手機／桌機排版、教學、載入失敗後援與後台安全連結。若要在 staging 驗證真實社群登入，另建該環境自己的 OAuth credentials，並將實際 preview hostname 加入 authorized domains；不更改 production OAuth。

## 參考作品與唯讀預演

固定清單位於 `scripts/curated-fanart.json`，三篇在 2026-10-04（Asia/Taipei）由人查看官方嵌入確認：包含天音彼方粉絲繪圖、`#かなたーと`、顯示超過 100 個讚。`4.4K` 與 `5.5K` 保留 X 顯示字串，不換算成精確整數。這是當時觀察值，會變動。

```bash
npm run import:curated-fanart -- --help
npm run import:curated-fanart -- --project kanata-memorial --owner-uid <existing-owner-uid>
```

預設只讀：使用 ADC 讀取指定 project 的 Owner Auth record、adminAccounts 與三個 deterministic fanart IDs，輸出實際 add／skip 計劃。不登入、不取得 Owner session、不寫 Firestore／Storage、不修改既有資料。ADC 與 Firebase CLI 登入各自獨立；缺 ADC 或權限時需先在本機修正該條件。

## Production 最小發布順序

1. 完成本機與 staging 驗收、Gitleaks 門檻。將本次變更提交後，以乾淨 HEAD 建立新的 annotated `governance-production-YYYYMMDDTHHMMSSZ` tag。保存目前 live 對應的前一個已驗證 annotated release tag，不能把本次 tag 當成前一版。
2. 以新增的增量模式保存 public/admin Hosting live versions、Rules releases、ACTIVE Functions inventory、既有 Auth 設定及前一個 release revision：

```bash
npm run baseline:production -- \
  --project kanata-memorial --confirm-production kanata-memorial \
  --release-tag <new-release-tag> --incremental-release \
  --previous-release-tag <currently-deployed-release-tag> --apply
```

3. `deploy:production --phase maintenance` 開啟 backend lock，發布 maintenance public page 與 temporary Rules。以 `backup:production --label final` 成功完成 final backup，保存 operation name；本次不執行 governance migration。
4. 執行 `deploy:production --phase backend`，不加 `--allow-owner-bootstrap`。執行 `verify:production:backend --expect-bootstrap disabled --verify`，確認新版 18 個 Functions、所有宣告索引 READY、HTTP invoker 與匿名 callable 拒絕。檢查合法登入者呼叫舊圖片 API 明確拒收，新連結 API 在 maintenance 拒收。
5. 執行 `deploy:production --phase governance` 發布最終 Rules、Storage 禁止新圖片寫入及新版 admin。確認舊圖片仍能透過 proxy 讀取，隱藏／刪除內容不能公開讀；後台只提供安全的 X 原文連結，不載入 X widgets，不擴大 admin CSP。
6. 在 maintenance 中執行下節的 Owner 參考作品匯入，先重新 dry-run。驗收後執行 `deploy:production --phase release`；public Hosting 成功後腳本才解除 lock。
7. 驗證 Google/GitHub 一般使用者的連結投稿、重複提示、配額、教學、X 不可用後援、檢舉與 admin 管理；保留 baseline、backup 與 release tag。完整流程可使用模擬器，正式 smoke check 避免建立不必要的投稿／檢舉資料。

上述 production npm commands 均須沿用部署手冊要求的 `--project kanata-memorial --confirm-production kanata-memorial --release-tag <new-release-tag>`。維護窗口開始前確認沒有管理資料異動；final export 完成前不匯入或治理。

## Owner 匯入操作

Apply 同時需要 ADC 資料存取權與**實際 Owner 的 Password session**，僅持有 ADC 或指定 Owner UID 不足。先在 `admin.eienkanata.com` 以 Owner Password 登入，確認後台顯示 Owner。若瀏覽器提供 DevTools，可使用該頁的 `copy(await FirebaseApp.getAuth().currentUser.getIdToken(true))` 將短效 ID token 複製至本機剪貼簿；不要在 Console 顯示 token，不貼到聊天、不存檔、不放 command argument、environment variable 或 shell history。

Codex 的 in-app-browser 未提供可執行指令的 Console，不能要求使用者在其中操作 DevTools。此時可由一次性本機登入交接重新驗證既有 Owner 密碼：使用已安裝的 Firebase client SDK、`inMemoryPersistence` 與明確 production 設定，token 只經 child stdin 交給同一 importer。登入頁若採 localhost，僅綁定 `127.0.0.1`，使用精確 Host／Origin、隨機 nonce、no-store 與登入嘗試／有效時間限制；不修改 production admin CSP，不跨來源讀取既有瀏覽器 session，不新增常駐 API。完成或取消時清除本機 client session；不得在 importer child 尚未結束時取消交接，也應在有效期限保留足夠餘裕。

在執行 apply 前，人必須重新打開清單中的三篇貼文，確認仍為公開、包含彼方粉絲繪圖與 `#かなたーと`，且當下超過 100 個讚。`--confirm-eligibility-date` 必須是當日台北日期，代表此次人工核實；程式不自動抓取讚數。官方 oEmbed 另確認當下可嵌入，失敗即停止。

```bash
npm run import:curated-fanart -- \
  --project kanata-memorial --owner-uid <existing-owner-uid> \
  --confirm-production kanata-memorial --release-tag <new-release-tag> \
  --backup-operation <successful-final-export-operation> \
  --confirm-eligibility-date <today-in-Asia-Taipei> --apply
```

在隱藏 terminal prompt 貼上 token 並按 Enter；程式驗證 token 未撤銷、provider 為 password、UID 相同、Owner claims／帳號／session version 有效。所有 token 僅保留在記憶體，不寫入或輸出。完成後清空本機剪貼簿。

每篇使用共用 canonical URL、`x_<post-id>` ID 與 fanart schema。原 X 作者資訊留在官方嵌入與 curation metadata；artist／submitter 是實際匯入者。既有項目（包含已隱藏或已刪除）只 skip，不更新、不恢復。新增記錄、總 fanartCount 與 admin audit 在同一 transaction 完成；不修改 daily counts 或 pending upload quota。每次 transaction 重驗 Owner 帳號與 production maintenance lock。固定三筆可能在中途失敗留下部分已成功項目；修正阻礙後以相同清單重跑，已成功的項目會 skip。

Emulator fixture 演練以 `--project demo-kanata-governance`、Auth/Firestore emulator environment 與 emulator Owner Password-session token 執行相同流程；不接受缺少兩個 emulator hosts 的 demo import。Staging apply 使用 staging Owner 的 session；production final-backup/tag gate 不適用該隔離環境，但人工當日核實與 Owner authorization 仍必要。

## 回滾

先重新開啟 maintenance lock，保存新增 X 文件 ID 與原可見狀態。舊版 gallery renderer 不能呈現 X 文件，所以透過 `moderateContent hide` 暫時隱藏仍可見的 X 投稿，保留內容與 admin audit；不要刪除或以全資料庫還原覆蓋其他新留言／治理紀錄。

從 baseline 指定的上一個 release revision 恢復 Functions、Rules、public/admin Hosting。恢復時確認 `submitFanartLink` 不再可接受寫入，舊版需要的 media／cleanup 仍存在。使用已驗證的上一個 release tag 與乾淨 checkout；`release` phase 會重新發布該 revision 的 public output，成功才解除維護。若改採 Hosting version rollback，也必須一併恢復後端與 Rules，驗收後才以維護工具解除 lock。

修正版重新發布後，只恢復回滾清單中原先可見且未產生新治理決議的項目；原本因檢舉、管理隱藏或刪除的項目維持原決議。只有驗證到實際資料損壞時才考慮 managed export restore，依既有 production 手冊在維護中處理。

## 純公開畫面增量發布

公開 Toast 樣式與畫廊展示大小只更新前端，不需要維護鎖、資料匯入或後端／Rules 發布。先完成 Hosting build 測試、完整 E2E、真實 X 元件的雙欄／三欄切換驗收與 production Hosting build；參考作品可僅放入預覽瀏覽器記憶體，不寫入 staging 資料。

將變更提交並建立符合既有格式的 annotated release tag。以 `requireProductionReleaseTag` 驗證乾淨 HEAD 與 tag，再以 ADC 唯讀取得目前 public Hosting live release／version，保存至忽略追蹤的 `.production-backups/` manifest，連同前一版與新版 tag／commit。發布前再次確認 live version 未變。

```bash
npm run build:hosting:production
firebase deploy --only hosting:public --config firebase.production.json \
  --project kanata-memorial --non-interactive
```

不要使用 `deploy:production --phase release` 執行這種純 UI 更新：該 phase 會額外寫入維護鎖狀態。發布後檢查真實畫廊、展示偏好、通知及兩份樣式的 `Cache-Control: no-cache`，將新 live release／version 寫回同一 manifest。

若驗收失敗，使用 manifest 中發布前的確切版本回滾同一 public site：`firebase hosting:clone kanata-memorial@<previous-version-id> kanata-memorial:live --project kanata-memorial --non-interactive`。不依較早 baseline 猜測目前 live version，也不更動 admin、資料或維護鎖。

## Out-Of-Scope

本次不重做 Hosting/DNS/Auth setup、寄件網域驗證、Owner bootstrap 或既有治理 migration；不擴大 admin CSP、不備份 X 原圖、不自動爬讚數、不導入付費 X API、不定期抓取熱門作品。
