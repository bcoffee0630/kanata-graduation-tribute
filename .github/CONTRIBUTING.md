# Contributing Guide / 貢献ガイド / 貢獻指南

Thank you for your interest in contributing to this memorial site for Amane Kanata!

このメモリアルサイトへの貢献に興味を持っていただきありがとうございます！

感謝您有興趣為這個天音彼方紀念網站做出貢獻！

---

## Table of Contents / 目次 / 目錄

- [Easy Submission (Recommended) / 簡単投稿（推奨）/ 簡易投稿（推薦）](#easy-submission-recommended--簡単投稿推奨--簡易投稿推薦)
- [Advanced: PR Submission / 上級者向け：PR投稿 / 進階：PR 投稿](#advanced-pr-submission--上級者向けpr投稿--進階pr-投稿)
- [Code Contribution / コード貢献 / 程式碼貢獻](#code-contribution--コード貢献--程式碼貢獻)

---

## Easy Submission (Recommended) / 簡単投稿（推奨）/ 簡易投稿（推薦）

The easiest way to submit your message or fan art is through our GitHub Issue forms. No Git knowledge required!

最も簡単な投稿方法は、GitHub Issue フォームを使用することです。Git の知識は不要です！

最簡單的投稿方式是使用 GitHub Issue 表單，不需要 Git 知識！

### Submit a Message / メッセージを投稿 / 投稿留言

Click the button below to submit your message:

下のボタンをクリックしてメッセージを投稿：

點擊下方按鈕投稿留言：

**[Submit Message / メッセージを投稿 / 投稿留言](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=submit-message.yml)**

- Fill out the simple form
- Choose your language (Japanese, Traditional Chinese, or English)
- Your message will appear on the site after review

### Submit Fan Art / ファンアートを投稿 / 投稿粉絲創作

Click the button below to submit your artwork:

下のボタンをクリックしてファンアートを投稿：

點擊下方按鈕投稿粉絲創作：

**[Submit Fan Art / ファンアートを投稿 / 投稿粉絲創作](https://github.com/bcoffee0630/kanata-graduation-tribute/issues/new?template=submit-fanart.yml)**

#### Image Requirements / 画像の要件 / 圖片要求

| | English | 日本語 | 繁體中文 |
|---|---------|--------|----------|
| Format | PNG or JPG | PNGまたはJPG | PNG 或 JPG |
| Recommended | Under 2MB | 2MB以下推奨 | 建議 2MB 以下 |
| Max size | 10MB | 最大10MB | 最大 10MB |
| Resolution | 1920x1080 recommended | 1920x1080推奨 | 建議 1920x1080 |
| Content | Original artwork | オリジナル作品 | 原創作品 |

---

## Advanced: PR Submission / 上級者向け：PR投稿 / 進階：PR 投稿

For those familiar with Git, you can also submit via Pull Request:

Gitに慣れている方は、Pull Requestでも投稿できます：

熟悉 Git 的使用者也可以透過 Pull Request 投稿：

### How to Contribute / 貢献方法 / 如何貢獻

1. **Fork** this repository / このリポジトリを **Fork** する / **Fork** 這個儲存庫
2. **Clone** your fork / フォークを **Clone** する / **Clone** 您的 fork
3. **Create a branch** / **ブランチを作成** / **建立分支**
4. **Make your changes** / **変更を加える** / **進行修改**
5. **Commit & Push** / **Commit & Push** / **Commit & Push**
6. **Create a Pull Request** / **Pull Request を作成** / **建立 Pull Request**

### Fan Art via PR / ファンアート（PR）/ 粉絲創作（PR）

1. Add your image to `memories/fanart/images/`
2. Update `memories/fanart/index.json`:

```json
{
  "id": "XXX",
  "filename": "your-image.png",
  "path": "images/your-image.png",
  "artist": "Your Name",
  "artistLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "isOfficial": false,
  "caption": {
    "ja": "日本語の説明",
    "zh-TW": "繁體中文說明",
    "en": "English description"
  }
}
```

### Message via PR / メッセージ（PR）/ 留言（PR）

Update `memories/messages/messages.json`:

```json
{
  "id": "XXX",
  "author": "Your Name",
  "authorLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "content": {
    "ja": "日本語のメッセージ",
    "zh-TW": "繁體中文留言",
    "en": "English message"
  }
}
```

**Note:** Messages only appear when the viewer's language matches. You can provide one or more languages.

**注意:** メッセージは閲覧者の言語と一致する場合のみ表示されます。1つ以上の言語を提供できます。

**注意：** 留言只會在瀏覽者的語言相符時顯示。您可以提供一種或多種語言。

---

## Code Contribution / コード貢献 / 程式碼貢獻

### Tech Stack / 技術スタック / 技術架構

- HTML5
- CSS3 (Vanilla CSS, no frameworks)
- JavaScript (Vanilla JS, no frameworks)
- GitHub Pages for hosting

### Project Structure / プロジェクト構造 / 專案結構

```
kanata-graduation-tribute/
├── index.html              # Main page
├── assets/
│   ├── css/
│   │   ├── style.css       # Main styles
│   │   ├── gallery.css     # Gallery styles
│   │   └── danmaku.css     # Danmaku styles
│   ├── js/
│   │   ├── i18n.js         # Internationalization
│   │   ├── counter.js      # Day counter
│   │   ├── gallery.js      # Gallery functionality
│   │   └── danmaku.js      # Danmaku functionality
│   └── locales/
│       ├── ja.json         # Japanese translations
│       ├── zh-TW.json      # Traditional Chinese translations
│       └── en.json         # English translations
├── memories/
│   ├── fanart/             # Fan art data
│   └── messages/           # Fan messages data
└── images/                 # Site images
```

### Development Guidelines / 開発ガイドライン / 開發指南

- Keep it simple - no build tools or frameworks required
- Test in multiple browsers (Chrome, Firefox, Safari, Edge)
- Test responsive design on mobile devices
- Follow existing code style
- Add translations for all three languages when adding new text

---

## Questions? / 質問? / 有問題？

Feel free to open an issue if you have any questions!

ご質問があればお気軽にIssueを開いてください！

如果有任何問題，歡迎開 Issue 詢問！

---

Forever Kanata / 永遠にかなた / 永遠的彼方
