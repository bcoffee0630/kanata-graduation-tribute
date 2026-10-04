# 投稿治理後台操作手冊

## 環境邊界

- Staging Firebase project: `kanata-memorial-admin`
- Production Firebase project: `kanata-memorial`
- `scripts/deploy-preview.mjs` 只接受 staging，指定 production 會直接失敗。
- `.firebaserc` 的 default 是 staging；staging 指令仍應明確指定 `--project kanata-memorial-admin`。
- Production 只能使用 `scripts/deploy-production.mjs` 的明確 phase 與雙重 project 確認；完整步驟見 [Production 部署手冊](production-deployment.md)。

## 本機驗證

```bash
npm run build
npm run test:functions
npm run test:rules
npm run test:integration
npm run test:e2e
```

`test:rules`、`test:integration` 與 `test:e2e` 使用 `demo-kanata-governance` Emulator project，不會連接 staging 或 production 資料。

## Staging 前置資源

在 `kanata-memorial-admin` 建立或啟用：

1. Firestore `(default)` database，location `asia-east1`。
2. Firebase Storage default bucket。
3. Firebase Web App，供 Hosting 的 `/__/firebase/init.json` 提供設定。
4. Authentication 的 Email/Password provider。
5. 將 Hosting preview domain 加入 Authentication authorized domains。

目前 staging 不設定 Google 或 GitHub OAuth；若未來需要社群登入，再為各環境建立獨立 OAuth 憑證。

## 第一位 Owner

1. 在 staging Authentication 建立 Email/Password 帳號並取得 UID。
2. 建立忽略於 Git 的 `functions/.env.kanata-memorial-admin`：

```dotenv
BOOTSTRAP_OWNER_UID=<staging-auth-uid>
```

3. 完成 preview 部署後，以該帳號登入 `/admin/?bootstrap=1`。
4. 執行一次性 bootstrap。成功後會建立 `system/bootstrap` 鎖、Owner claim、管理員文件與稽核紀錄。
5. 後續一律使用 `/admin/`；其他無管理權限帳號登入後會立即登出。

管理員權限同時驗證 Auth custom claims 與 `adminAccounts/{uid}` 的 role、disabled、session version。停用、降級或撤銷工作階段會使舊 token 立即失效。

## 投稿上限

「投稿上限」頁可分別設定留言與畫廊的每日預設值；未儲存時維持 3 則留言／2 件投稿，以 `Asia/Taipei` 的日曆日換日。全站預設接受非負安全整數，0 表示停止該類新投稿。

在「用戶管理 → 用戶詳情 → 投稿上限」可為兩類分別選擇「使用預設」「自訂數量」或「無上限」。只有 Owner 可儲存全站及個別設定，其他管理員可查看來源、生效額度及當日用量。每次儲存須提供 3–500 字原因；若提示設定已變更，先重新載入並確認目前內容，再重新填寫，不會自動覆蓋他人的異動。

變更立即套用於下一次送出，不重置今日用量。無上限期間也持續計數；調回有限值或繼承預設時，沿用當日已用量。調高立即增加差額，調低到已用量以下則停止該類新投稿。全站預設不可設無上限，管理員或創作者也不會依身分自動豁免，需由 Owner 選定 UID 設定。

額度綁定本站 Firebase UID，不綁 Email 或 X 作者。公開投稿仍要求同 UID 的 Google／GitHub 登入；Password-only 後台帳號不會因無上限取得投稿資格。禁言、封鎖、維護、貼文可用性與重複投稿規則均持續生效。

公開兩個投稿彈窗會讀取本人的有效額度及今日用量；取得失敗時仍以送出 API 的後端判定為準。設定與前後值寫入 `adminAuditLogs`，動作為 `contribution.defaults.update` 或 `contribution.user.update`。設定集合禁止直接 client 存取，不需遷移或清空既有計數。發布及回滾見 [投稿上限增量發布](contribution-limits-release.md)。

## Staging 遷移

預設只輸出 dry-run 統計：

```bash
npm --prefix functions run migrate:governance -- --project kanata-memorial-admin
```

確認 staging 測試資料後才套用：

```bash
npm --prefix functions run migrate:governance -- \
  --project kanata-memorial-admin \
  --storage-bucket <staging-storage-bucket> \
  --apply
```

遠端執行需要使用者 Application Default Credentials。套用模式會重寫舊圖片物件並移除 Firebase download token，再改用治理媒體代理；因此必須明確提供 Storage bucket。Production 另要求 project 確認值與已成功完成的 Firestore export operation ID。

## Preview 部署

```bash
npm run deploy:preview -- --project kanata-memorial-admin
```

腳本先建置 Functions 與 Hosting 白名單輸出，再部署 staging Functions、Firestore Rules、Indexes、Storage Rules，最後只建立 `admin-governance` Hosting preview channel，效期七天。Hosting 僅從 `.hosting-preview` 部署明確列出的前端資源。腳本不會部署 staging live channel，也不會呼叫 production。

## Production

Production 使用同專案第二個 Hosting site 與 `admin.eienkanata.com`，公開站與後台共享 Auth、Firestore、Functions，但有獨立內容、headers、release 與 domain。切換前必須完成秘密掃描、Node.js 22 測試、DNS/SSL、Auth 寄件網域、Gmail 投遞、備份、索引及 IAM 門檻；操作順序與回滾方式見 [Production 部署手冊](production-deployment.md)。
