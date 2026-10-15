# 介紹區、頁尾整理與基本 SEO 驗證

驗證日期：2026-10-15（Asia/Taipei）。只更新公開前端；後台、後端、Rules 與資料不變。

## 用語

- 彼方於 2025-12-02 宣布、2025-12-27 畢業，對粉絲而言不是值得慶祝的事，因此對外標題與分享文改為「粉絲紀念」語氣：`<title>` 與 og／twitter 標題為「天音かなた ファンメモリアル／天音彼方 粉絲紀念站／Amane Kanata Fan Tribute」，分享文改為致謝語。依擁有者決定，hero 主標題暫時維持原本的「卒業記念」用語。
- 粉絲稱呼沿用官方個人頁的「へい民」、中文圈「嘿民」（4Gamers TW）與英文「Heimin」；英文 PP 天使改為社群常用的「PP Tenshi」。README 的「追悼」改為「記念・感謝」，避免暗示過世。
- 維護頁的「即將回歸／Coming Back Soon」改為指網站本身恢復，避免被誤讀為本人回歸。

## 介紹區

- Hero 與留言之間改為：標題 → 本人介紹（Hololive 四期生、2019-12-27 首次直播、2025-12-27 畢業，只寫公開事實、不談畢業原因）→ ✦ 分隔線 → 網站說明（粉絲名與網站用途，兩句各自一行）。
- 兩段文字使用相同的灰色字樣；移除背景的引號與 ∞ 裝飾。
- 不使用官方立繪：COVER 未提供粉絲可用素材，且二次創作指引將原樣使用官方內容排除在二次創作之外，因此只連結官方個人頁（頁尾素材來源）。

## 導覽

- 新增「紹介／介紹／About」連到 `#intro`；「首頁」改連 `#top`（body），回到頁面最上方。
- 769–960px 時導覽連結間距縮小、登入按鈕改為與手機相同的僅圖示，三語皆不換行、不溢出。

## 頁尾

- 依序為：非官方、非營利聲明與官方資訊指引 → 三欄（素材來源／版權與使用／相關條款）→ 內容或版權疑慮的 GitHub Issues 聯絡方式；手機改為單欄置中。
- 素材來源新增官方個人頁（個人資料來源）及介面圖示 Feather Icons（MIT）· Lucide（ISC）；README 列出各來源授權與著作權聲明。

## 基本 SEO

- 中日英 meta description、canonical、og:site_name／locale／image 尺寸與替代文字、twitter 標題／描述／圖片、theme-color，以及 `WebSite` JSON-LD（about 指向本人與官方頁面）。
- 新增 `robots.txt`（允許全站、排除 `/api/`、宣告 sitemap）與 `sitemap.xml`（僅 `/`），production 與 preview Hosting build 都會複製。未做多語網址與 hreflang。

## 本機證據

- `npm run test:build` 198／198 通過（新增 robots／sitemap build 斷言）；`npm run test:e2e` 249 通過、11 略過、0 失敗（含更新後的三語頁面標題斷言）；production Hosting build（public 30 個允許檔案）、`git diff --check`、Gitleaks 通過。
- 內建瀏覽器以本機靜態伺服器驗證三語文案、無未翻譯鍵、JSON-LD 可解析、robots／sitemap 回應 200；介紹區與頁尾在 375、769、961、1100、1440px 無水平溢出，導覽三語不換行。
- 靜態伺服器沒有 Firebase 設定與 API，console 只有 `/__/firebase/init.json` 及 `/api/*` 的 404，與本次變更無關。

版本：style CSS v18；modal CSS v3；i18n JS 與語系 JSON v12；share JS v2。
