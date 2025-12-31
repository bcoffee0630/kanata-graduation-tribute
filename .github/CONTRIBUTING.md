# Contributing Guide / 貢献ガイド / 貢獻指南

Thank you for your interest in contributing to this memorial site for Amane Kanata!

このメモリアルサイトへの貢献に興味を持っていただきありがとうございます！

感謝您有興趣為這個天音彼方紀念網站做出貢獻！

---

## Submit Messages / Fan Art / 投稿留言・繪圖

**Submit directly on the website!**
**サイトで直接投稿できます！**
**可以直接在網站上投稿！**

Visit [eienkanata.com](https://eienkanata.com/), log in with your **GitHub or Google** account, and click the submit button.

[eienkanata.com](https://eienkanata.com/) にアクセスし、**GitHub または Google** アカウントでログインして投稿ボタンをクリック。

前往 [eienkanata.com](https://eienkanata.com/)，使用 **GitHub 或 Google** 帳號登入，點擊投稿按鈕。

---

## Code Contribution / コード貢献 / 程式碼貢獻

Want to improve the site's design or features? Pull Requests are welcome!

サイトのデザインや機能を改善したいですか？Pull Requestを歓迎します！

想改進網站的設計或功能？歡迎提交 Pull Request！

### What You Can Contribute / 貢献できること / 可以貢獻的項目

| Area / 領域 | Examples / 例 |
|-------------|---------------|
| **CSS / Styles** | Design improvements, animations, responsive fixes |
| **Translations** | Improve ja.json, zh-TW.json, en.json |
| **Static Features** | Counter, animations, effects, i18n |
| **Bug Fixes** | Layout issues, browser compatibility |

---

### Local Development / ローカル開発 / 本地開發

1. **Fork** this repository / このリポジトリを **Fork** / **Fork** 這個儲存庫

2. **Clone** your fork / フォークを **Clone** / **Clone** 您的 fork
   ```bash
   git clone https://github.com/YOUR_USERNAME/kanata-graduation-tribute.git
   cd kanata-graduation-tribute
   ```

3. **Start local server** / ローカルサーバー起動 / 啟動本地伺服器
   ```bash
   python -m http.server 8000
   ```
   Open [http://localhost:8000](http://localhost:8000)

4. **Create a branch** / ブランチを作成 / 建立分支
   ```bash
   git checkout -b feature/your-feature-name
   ```

5. **Make your changes** / 変更を加える / 進行修改

6. **Test your changes** / テスト / 測試

7. **Commit & Push** / コミット＆プッシュ
   ```bash
   git add .
   git commit -m "Add your feature description"
   git push origin feature/your-feature-name
   ```

8. **Create a Pull Request** / Pull Request を作成 / 建立 Pull Request

---

### Testing Limitations / テスト制限 / 測試限制

> **Note**: Firebase features (authentication, messages, fanart) cannot be tested locally. The site uses Firebase Hosting for deployment.
>
> **注意**: Firebase 機能（認証、メッセージ、ファンアート）はローカルでテストできません。
>
> **注意**: Firebase 功能（認證、留言、繪圖）無法在本地測試。

**What you CAN test locally / ローカルでテスト可能 / 可以本地測試:**
- HTML structure and CSS styling
- Static JavaScript (counter, animations, effects)
- Translation files (locales/*.json)
- Responsive design

**What you CANNOT test locally / ローカルでテスト不可 / 無法本地測試:**
- Login (GitHub/Google OAuth)
- Submit messages or fanart
- Danmaku display
- Gallery display

For Firebase-related changes, describe your changes clearly in the PR. The maintainer will test them before merging.

Firebase 関連の変更は、PR で詳しく説明してください。マージ前にメンテナーがテストします。

Firebase 相關的變更，請在 PR 中詳細說明。維護者會在合併前進行測試。

---

### Tech Stack / 技術スタック / 技術架構

- HTML5
- CSS3 (Vanilla CSS, no frameworks)
- JavaScript (Vanilla JS, no frameworks)
- Firebase (Hosting, Firestore, Storage, Auth)

### Project Structure / プロジェクト構造 / 專案結構

```
kanata-graduation-tribute/
├── index.html              # Main page
├── 404.html                # 404 page
├── assets/
│   ├── css/
│   │   ├── style.css       # Main styles
│   │   ├── gallery.css     # Gallery styles
│   │   ├── danmaku.css     # Danmaku styles
│   │   └── modal.css       # Modal styles
│   ├── js/
│   │   ├── firebase-init.js    # Firebase initialization
│   │   ├── auth.js             # Authentication (GitHub + Google)
│   │   ├── submit.js           # Submission handling
│   │   ├── report.js           # Report functionality
│   │   ├── i18n.js             # Internationalization
│   │   ├── counter.js          # Day counter
│   │   ├── gallery.js          # Gallery functionality
│   │   ├── danmaku.js          # Danmaku functionality
│   │   ├── animations.js       # Animations
│   │   └── effects.js          # Visual effects
│   └── locales/
│       ├── ja.json         # Japanese translations
│       ├── zh-TW.json      # Traditional Chinese translations
│       └── en.json         # English translations
└── images/                 # Site images
```

### Development Guidelines / 開発ガイドライン / 開發指南

- Keep it simple - no build tools or frameworks required
- Test in multiple browsers (Chrome, Firefox, Safari, Edge)
- Test responsive design on mobile devices
- Follow existing code style
- Add translations for all three languages when adding new text

### Important Notes / 重要な注意事項 / 重要注意事項

- Deployment is handled by the maintainer via Firebase Hosting
- Firebase configuration files are not included in the repository
- All contributions are subject to the [Code of Conduct](CODE_OF_CONDUCT.md)

---

## Translation Contribution / 翻訳貢献 / 翻譯貢獻

Help us improve translations! You can:

翻訳の改善にご協力ください！以下の方法があります：

幫助我們改進翻譯！您可以：

1. **Submit an Issue** / **Issue を作成** / **建立 Issue**
   - Use the [Translation template](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=translation.yml)

2. **Submit a PR** / **PR を提出** / **提交 PR**
   - Edit files in `assets/locales/`
   - Make sure to update all three language files if adding new keys

---

## Report Issues / 問題報告

- [Bug Report / バグ報告](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=bug_report.md)
- [Feature Request / 機能リクエスト](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=feature_request.md)
- [Translation / 翻訳提案](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=translation.yml)
- [Report Content / コンテンツ報告](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=report-content.yml)

---

## Questions? / 質問? / 有問題？

Feel free to open an issue if you have any questions!

ご質問があればお気軽にIssueを開いてください！

如果有任何問題，歡迎開 Issue 詢問！

---

Forever Kanata / 永遠にかなた / 永遠的彼方
