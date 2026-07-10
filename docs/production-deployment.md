# Production 治理後台部署手冊

## 固定邊界

- Production project: `kanata-memorial`
- Public Hosting site: `kanata-memorial`
- Admin domain: `admin.eienkanata.com`
- Auth mail domain: `auth.eienkanata.com`
- Storage bucket: `kanata-memorial.firebasestorage.app`
- Admin Site ID 依序嘗試 `eienkanata-admin`、`kanata-memorial-governance`、`eienkanata-governance`。
- 所有 production 變更都必須從乾淨工作樹執行；程式部署另要求指向目前 commit 的 annotated release tag，格式為 `governance-production-YYYYMMDDTHHMMSSZ`。

任何秘密命中、Node.js 22 測試失敗、備份未成功、索引未 Ready、HTTP Function 缺少 public invoker、隱藏資料可被一般用戶讀取、SSL 未 Connected、郵件驗證失敗或 Gmail 判定垃圾郵件，均停止，不進 maintenance 或 release。

## 本機前置

1. 安裝 Node.js 22、Firebase CLI、Google Cloud CLI 與 Gitleaks。
2. `firebase projects:list` 必須同時列出 staging 與 production；Firebase CLI 登入不等於 Application Default Credentials，另執行使用者 ADC 登入供 Admin SDK migration 使用。
3. 由 `.production-owner.example` 建立本機 `.production-owner.env`，填入 Owner UID 與 Email。該檔已被 Git 忽略。
4. 建立忽略檔 `functions/.env.kanata-memorial`，初次部署填入相同 Owner UID：

```dotenv
BOOTSTRAP_OWNER_UID=<production-owner-uid>
```

5. 在 Node.js 22 下執行：

```bash
npm ci
npm --prefix functions ci
npm test
npm run test:e2e
npm run build:hosting:production
```

## 秘密與 Git 門檻

```bash
gitleaks dir . --redact --no-banner
gitleaks git . --redact --no-banner --log-opts="--all"
```

只用明確檔案清單 `git add`，審查 `git diff --cached` 後再執行：

```bash
gitleaks git . --pre-commit --redact --staged --no-banner
```

三次皆零結果才能提交。若命中真實秘密，先停止並輪替；不得用寬泛 allowlist 掩蓋。`.gitleaksignore` 只保留已人工確認為公開識別值、且同時受 Git ignore 與 Hosting 白名單排除的單一 fingerprint。`.production-owner.env`、Functions env、Firebase cache、Hosting outputs、備份、service-account、OAuth secret、私鑰及 keystore 都不得進 Git。

## Hosting 與網域

1. 執行冪等 setup 工具。它只接受固定 production project，依序選擇核准的 Site ID、建立或重用唯一命名的 Web App、連結兩者、建立 `admin.eienkanata.com` custom-domain resource，並設定 deploy targets：

```bash
npm run setup:production:hosting -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --apply
```

2. 工具只會在 Firebase 已產生 `requiredDnsUpdates`（或網域已 Active）後寫入被忽略的 `0600` manifest。它同時更新 `.firebaserc` targets；以明確檔案清單提交該變更，再重跑 staged 與 history Gitleaks。
3. 在最終 commit 建立 annotated tag，後續所有 `<release-tag>` 均使用同一值：

```bash
git tag -a governance-production-YYYYMMDDTHHMMSSZ -m "Production governance release"
```

4. 依 manifest 新增 DNS 紀錄；保留既有 apex `hosting-site=kanata-memorial` TXT，不替換或刪除任何既有紀錄。
5. 等待 Hosting 狀態為 `Connected`，並確認 SSL 憑證有效後才繼續。
6. 在 Auth Templates 將寄件網域設為 `auth.eienkanata.com`，新增 Firebase 指定的 TXT/CNAME/SPF/DKIM；另新增 `_dmarc.auth.eienkanata.com` TXT：`v=DMARC1; p=none`。
7. 驗證完成後才套用自訂寄件網域；sender 設為 `noreply@auth.eienkanata.com`，顯示名稱為 `eienkanata.com`。Firebase Auth 只接受 default Hosting site 的 email callback，因此 Password reset action URL 使用 `https://eienkanata.com/auth/action/`；public 與 maintenance Hosting 都提供 no-store bridge page，原樣保留查詢參數並導向 `https://admin.eienkanata.com/auth/action/`。不得修改既有 Google/GitHub OAuth provider。
8. 將 Firebase Console 顯示的完整郵件 TXT/CNAME 記錄寫入本機 `.production-mail-dns.json`（格式見空值 example），再執行只讀驗證：

```bash
npm run verify:production:domains -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --admin-hosting-site <admin-site-id> \
  --verify
```

工具會核對 SPF、DKIM、`_dmarc.auth.eienkanata.com` 的 `p=none`、Hosting ownership/host state、SSL certificate 與實際 HTTPS。Firebase Console 仍必須顯示綠色 `Verification complete`，且套用自訂網域後才能進下一階段。

## Auth 設定

先 dry-run，確認 Google 與 GitHub 都仍 enabled。不得在下一節 baseline capture 前執行 Apply；Apply 必須等 Admin preview 部署後取得實際 hostname，並將該 hostname 一併列入 authorized domains：

```bash
npm run configure:production:auth -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --admin-hosting-site <admin-site-id>

npm run configure:production:auth -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --admin-hosting-site <admin-site-id> \
  --admin-preview-domain <admin-site-id>--<preview-channel>.web.app \
  --release-tag <release-tag> \
  --apply
```

Apply 先透過 Identity Toolkit `domain:verify` 要求 `auth.eienkanata.com` 驗證為 `SUCCEEDED`，隨即執行 `APPLY`。接著只啟用 Email/Password、加入 Admin domains、設定 `https://eienkanata.com/auth/action/`、保留 email enumeration protection，並強制 12–128 字元且含大小寫、數字及符號的 server-side password policy。它也會回讀確認自訂寄件網域、`eienkanata.com <noreply@auth.eienkanata.com>` 與 Google/GitHub provider 均未偏離。管理 API、Firestore Rules 與 Storage Rules 仍要求 `firebase.sign_in_provider == "password"`；同 UID 的 Google session 不具管理權。

Email/Password provider 可能被外部直接呼叫 signup API；不能開啟全域 `disabledUserSignup`，否則新的公開 Google/GitHub 使用者也會被阻擋。因此 `submitMessage`、創作 upload/finalize 與 `submitReport` 只接受 `google.com` 或 `github.com` token。Password-only 帳號即使自行建立，也不能投稿、上傳或站內舉報；只有具有效 admin claims 與 `adminAccounts` 文件的 Password session 能使用管理 API。

## 預先部署

1. 以唯讀 API 記錄 release commit、現有 public Hosting live version、Firestore/Storage Rules release 與 Auth provider 狀態；結果寫入被忽略的 `0600` baseline manifest：

```bash
npm run baseline:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --release-tag <release-tag> \
  --apply
```
2. 執行 preflight backup。工具會排除既有 `governance-backups/`、先複製其餘 Storage 物件，再建立完整 Firestore managed export，並將 operation name 與驗證結果寫入被忽略且權限為 `0600` 的 `.production-backups/` manifest：

```bash
npm run backup:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --label preflight \
  --release-tag <release-tag> \
  --apply
```
3. 部署 17 個 Functions 與 11 個 indexes，但不改最終 Rules：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase backend \
  --release-tag <release-tag> \
  --allow-owner-bootstrap
```

4. 等待所有 indexes `READY` 後執行驗證。工具核對 17 個 Functions、11 個本地宣告索引、15 個 HTTP services 的無條件 `allUsers` invoker，並匿名呼叫 14 個 callable 確認回 `UNAUTHENTICATED`：

```bash
npm run verify:production:backend -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --expect-bootstrap enabled \
  --verify
```

若僅缺少 invoker，經人工確認清單後才允許保留完整 IAM policy 與 etag 進行修復，再重跑純驗證：

```bash
npm run verify:production:backend -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --expect-bootstrap enabled \
  --verify \
  --repair-public-invokers \
  --confirm-public-invokers allUsers
```
5. 建立 Admin Hosting preview：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase admin-preview \
  --release-tag <release-tag>
```

6. 驗證 preview 的 `/`、`/auth/action/`、production Firebase project ID、security headers，以及 `.git`、env、Functions、Rules、scripts、tests、package 檔均為 404。
7. 為了讓 Firebase 驗證自訂 email action handler，先發布隔離的 Admin Hosting 第一個 live 版本；此階段不發布 public live、不改 Rules、Functions 或資料：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase admin-live \
  --release-tag <release-tag>
```

8. 驗證 `admin.eienkanata.com` 的 `/`、`/auth/action/`、security headers 與敏感路徑，再將完整 preview hostname 傳給上一節 Auth apply；禁止猜測或只加入基本 `web.app` domain。
9. 建立並於測試後刪除兩個臨時 Gmail plus-address Auth 帳號，寄送 reset mail；檢查 From/action-link domain、SPF、DKIM、DMARC alignment 與 Spam 分類。任何一項不合格即停止。

## Maintenance 與資料遷移

進入 15–30 分鐘維護窗口後：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase maintenance \
  --release-tag <release-tag>
```

確認公開讀取仍可用、舊頁面透過 Rules 或 Functions 的所有寫入均被拒絕。Final backup 與 migration 完成前不得在 Admin preview 或其他工具執行任何治理異動；Firestore managed export 不是啟動瞬間的快照，可能包含 export 執行期間的變更。接著執行 final backup：

`maintenance` phase 會先以 ADC 寫入不可由客戶端修改的 `system/maintenance` 鎖，再發布 Hosting 與 temporary Rules；公開投稿、upload/finalize 與站內舉報 Functions 也會回 `UNAVAILABLE`。`release` phase 只有在最終 Public Hosting 部署成功後才解除該鎖；解除失敗時網站維持唯讀並讓指令失敗。

```bash
npm run backup:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --label final \
  --release-tag <release-tag> \
  --apply
```

保存成功完成的 operation resource name。先 dry-run 並核對預期筆數，再 apply：

```bash
npm --prefix functions run migrate:governance -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial

npm --prefix functions run migrate:governance -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --storage-bucket kanata-memorial.firebasestorage.app \
  --backup-operation <completed-operation-resource-name> \
  --apply
```

Final backup 工具本身會在複製 Storage 前與啟動 export 前確認 maintenance lock。Migration 會再次確認該鎖、精確的 production Storage bucket，並向 Firestore API 驗證 operation 已 `SUCCESSFUL` 且輸出位於 `*-final/firestore` 固定路徑，才允許寫入。Preflight operation 不可用於 apply。Legacy content、case 與 reporter 子文件使用原子 transaction，既有案件決議與站內舉報不會被覆寫。

## Governance、Owner 與 Release

1. 部署最終 Rules 與 Admin live target；Public 仍維持 maintenance，後端維護鎖也保持啟用：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase governance \
  --release-tag <release-tag>
```

2. 建立不輸出、不記錄的隨機臨時 password credential：

```bash
node scripts/prepare-production-owner.mjs \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --release-tag <release-tag> \
  --confirm-owner-credential prepare
```

3. 從後台申請重設信，完成自訂 action page 後，以 Password provider 登入並執行一次 bootstrap。
4. 將 `functions/.env.kanata-memorial` 改為空值：

```dotenv
BOOTSTRAP_OWNER_UID=
```

5. 立即重新部署 bootstrap Function：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase bootstrap-lock \
  --release-tag <release-tag>
```

6. 重跑 backend verification，確認遠端 bootstrap Function 已沒有 Owner UID：

```bash
npm run verify:production:backend -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --expect-bootstrap disabled \
  --verify
```

再於公開站仍為 maintenance 時，驗證 Owner-Password 可管理、同 UID Owner-Google 被拒絕、隱藏資料不可公開讀、Storage 原圖不可直讀、media proxy 正常、所有管理操作有 audit log。
7. 上述驗收通過後才發布 Public live target；部署成功後腳本才解除後端維護鎖：

```bash
npm run deploy:production -- \
  --project kanata-memorial \
  --confirm-production kanata-memorial \
  --phase release \
  --release-tag <release-tag>
```

8. 開站後立即驗證一般用戶 Google／GitHub 登入、投稿、創作與舉報；保留 release tag、backup、舊 Hosting version 與 Rules release，觀察至少 24 小時。

## 回滾

- 未完成 migration：保持 maintenance，回切舊 Hosting version 與 Rules release，從 pre-release commit 重部署 Functions。
- migration 後資料異常：保持 maintenance，從已驗證的 managed export 還原，再回切 Hosting/Rules/Functions。
- Owner 異常：清除新增 claims 與 `adminAccounts`/bootstrap 文件，移除 Password credential，保留原 Google provider。
- 不論失敗點為何，都先以 `set-production-maintenance.mjs` 的雙重確認重新啟用後端維護鎖，再處理 Hosting／Rules 回切；確認舊公開站與資料一致後才重新開站。
