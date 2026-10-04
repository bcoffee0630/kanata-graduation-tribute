# 投稿上限增量發布

本次使用既有 production 專案、Auth、Owner 及治理規則。新設 `system/contributionLimits` 與 `userContributionLimits/{uid}`；缺失時沿用每日 3／2，不需要 migration、初始化設定、重算或清空統計。規則的 default-deny 已禁止設定直接讀寫，保持原規則。

## 發布前

- Node 22 下執行 Functions、Hosting build、Rules、整合及完整 E2E；公開額度 E2E 使用 Chromium／WebKit 桌面與手機，後台使用現有 Chromium 專案。
- Staging 使用 `kanata-memorial-admin`，驗收 Owner／Moderator 的預設與個別設定、版本衝突、三語及公開提示。暫時測試帳號、覆寫、全站設定與稽核由 fixture 明確追蹤並清理，既有 staging 設定按原快照回復。
- 更新正式驗證清單：新增 `getContributionDefaults`、`setContributionDefaults`、`setUserContributionLimits`、`getMyContributionLimits`，合計 22 個 Functions；不得刪除舊圖片入口或清理函式。
- 機密掃描通過後提交並建立 annotated `governance-production-YYYYMMDDTHHMMSSZ` tag，工作樹須乾淨。保存目前部署的前一版 tag，不能用過時的固定版本代替。

## 正式順序

1. 以既有 `baseline:production --incremental-release` 保存兩個 Hosting live version、舊 Function inventory、Rules 與 Auth 狀態；指定新 tag、前一版 tag 及 `eienkanata-admin`。不重跑初次治理／Owner／Auth 設定。
2. 完成 preflight 備份後開啟維護鎖，使用 `backup:production --label final` 完成 Firestore export 及媒體備份。
3. 部署後端並驗證 22 個 Functions 的 ACTIVE／Node 22、callable invoker、匿名拒絕、原有索引及 bootstrap 停用。
4. 發布後台，再發布公開 Hosting；維持維護鎖至檔案與唯讀畫面驗收完成，才解除維護。
5. 驗證預設仍為 3／2、未替正式用戶新增覆寫、投稿畫面顯示有效額度、原有畫廊與檢舉正常。正式 smoke check 不為驗收建立投稿、檢舉或修改額度；保存新 Hosting live version 與結果至忽略追蹤的 release manifest。

每個 production 命令都要指定 `kanata-memorial`、所需 confirmation 與本次 release tag。沿用既有 release guard；後台 site 為 `eienkanata-admin`，公開 site 為 `kanata-memorial`。

## 本次驗證

2026-10-05 以 Node 22 完成 43 項 Functions、33 項 Hosting build、13 項 Rules、26 項整合測試。完整 E2E 與修正測試同步後的集中重跑合計 132 個案例通過，8 個既有條件式案例略過；公開額度覆蓋 Chromium／WebKit 桌面與手機，後台覆蓋 Chromium 桌面與手機。

Staging 的實際 Owner 儲存、Moderator 唯讀及寫入拒絕、兩種版本衝突、桌面與手機畫面驗收通過。Staging 未啟用社群 OAuth，公開畫面使用實際設定快照與記憶體登入替身；完整社群登入投稿與本人額度 callable 在模擬器驗證，不改動 OAuth 設定。測試帳號及稽核清理後，原 staging 預設依快照恢復。

## 回滾

先開啟維護鎖，保存新設定、用量與稽核，不刪除文件或以全資料庫還原覆蓋新內容。若仍沒有自訂設定，可恢復 baseline 指定的上一版後端與兩個 Hosting，完成驗證才解除維護。

若新額度已被修改，僅回滾前端並保留配額後端，避免舊版固定 3／2 忽略個別設定。後端驗收失敗時保持維護並修復，不以不支援設定的舊後端解除維護。回滾不重置 Auth、Owner、DNS 或初次治理資料。
