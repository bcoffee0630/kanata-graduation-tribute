# 字體調整驗證

驗證日期：2026-10-15（Asia/Taipei）。只更新公開前端的字體載入與 CSS；後台、後端、Rules 與資料不變。

## 調整

- 中文標題（`html[lang="zh-TW"]` 的 h1、h2 與天數計數）改用繁中圓體 Chiron GoRound TC（300／500／700），字形符合台灣習慣；Zen Maru Gothic 細字會把「回」畫成近似圓形，改用後正常。日文與英文標題維持 Zen Maru Gothic。
- 頁尾「絶対的アイドル」改用鉛筆手寫風 Klee One（600），保留藍金漸層；三語皆為日文，字體支援。
- Noto Sans JP／TC 補載 500：網站 13 處指定 500，原本只載入 300／400／700，實際以 400 顯示。
- 英文內文由 Roboto 改為 Noto Sans（300／400／500／700），與中日文內文同屬 Noto 家族；不再載入 Roboto。
- 擁有者以本機左右比較頁（目前 vs 候選）確認四項皆採用。

## 本機證據

- `npm run test:build` 198／198 通過；`git diff --check` 通過。本次只改字體與 CSS，未重跑 e2e（上次發布 249 通過，頁面標題與結構未變）。
- 內建瀏覽器確認：中文 h1／介紹／回憶牆標題使用 Chiron GoRound TC，日英維持 Zen Maru Gothic；三語頁尾標語為 Klee One 600；中文導覽列計算粗細為 500 且 Noto Sans TC 500 已載入；英文內文為 Noto Sans，未載入 Roboto。

版本：style CSS v20。
