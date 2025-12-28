# Contributing Guide / 貢献ガイド / 貢獻指南

Thank you for your interest in contributing to this memorial site for Amane Kanata!

このメモリアルサイトへの貢献に興味を持っていただきありがとうございます！

感謝您有興趣為這個天音彼方紀念網站做出貢獻！

---

## Table of Contents / 目次 / 目錄

- [How to Contribute / 貢献方法 / 如何貢獻](#how-to-contribute--貢献方法--如何貢獻)
- [Fan Art Submission / ファンアート投稿 / 粉絲繪圖投稿](#fan-art-submission--ファンアート投稿--粉絲繪圖投稿)
- [Message Submission / メッセージ投稿 / 留言投稿](#message-submission--メッセージ投稿--留言投稿)
- [Code Contribution / コード貢献 / 程式碼貢獻](#code-contribution--コード貢献--程式碼貢獻)

---

## How to Contribute / 貢献方法 / 如何貢獻

### English

1. **Fork** this repository
2. **Clone** your fork to your local machine
3. **Create a branch** for your contribution
4. **Make your changes**
5. **Commit** your changes
6. **Push** to your fork
7. **Create a Pull Request**

### 日本語

1. このリポジトリを **Fork** する
2. フォークしたリポジトリをローカルに **Clone** する
3. 貢献用の **ブランチを作成** する
4. **変更を加える**
5. 変更を **Commit** する
6. フォークに **Push** する
7. **Pull Request を作成** する

### 繁體中文

1. **Fork** 這個儲存庫
2. **Clone** 您的 fork 到本機
3. **建立分支** 進行您的貢獻
4. **進行修改**
5. **Commit** 您的修改
6. **Push** 到您的 fork
7. **建立 Pull Request**

---

## Fan Art Submission / ファンアート投稿 / 粉絲繪圖投稿

### Guidelines / ガイドライン / 規範

| | English | 日本語 | 繁體中文 |
|---|---------|--------|----------|
| Format | PNG or JPG | PNGまたはJPG | PNG 或 JPG |
| Size | Under 2MB | 2MB以下 | 2MB 以下 |
| Resolution | 1920x1080 recommended | 1920x1080推奨 | 建議 1920x1080 |
| Content | Original artwork | オリジナル作品 | 原創作品 |

### Steps / 手順 / 步驟

#### English

1. Add your image to `memories/fanart/images/`
2. Update `memories/fanart/index.json`:

```json
{
  "id": "XXX",
  "filename": "your-image.png",
  "path": "memories/fanart/images/your-image.png",
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

3. Create a Pull Request using the "Fan Art Submission" template

#### 日本語

1. 画像を `memories/fanart/images/` に追加
2. `memories/fanart/index.json` を更新（上記フォーマット参照）
3. 「ファンアート投稿」テンプレートを使用してPull Requestを作成

#### 繁體中文

1. 將圖片新增至 `memories/fanart/images/`
2. 更新 `memories/fanart/index.json`（參考上方格式）
3. 使用「粉絲繪圖投稿」模板建立 Pull Request

---

## Message Submission / メッセージ投稿 / 留言投稿

### Steps / 手順 / 步驟

#### English

1. Update `memories/messages/messages.json`:

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

2. Create a Pull Request using the "Message Submission" template

**Note:** You only need to provide at least one language. We welcome multilingual messages!

#### 日本語

1. `memories/messages/messages.json` を更新（上記フォーマット参照）
2. 「メッセージ投稿」テンプレートを使用してPull Requestを作成

**注意:** 少なくとも1つの言語で記入してください。多言語でのメッセージも歓迎します！

#### 繁體中文

1. 更新 `memories/messages/messages.json`（參考上方格式）
2. 使用「留言投稿」模板建立 Pull Request

**注意：** 您只需要提供至少一種語言。歡迎多語言留言！

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

#### English

- Keep it simple - no build tools or frameworks required
- Test in multiple browsers (Chrome, Firefox, Safari, Edge)
- Test responsive design on mobile devices
- Follow existing code style
- Add translations for all three languages when adding new text

#### 日本語

- シンプルに保つ - ビルドツールやフレームワークは不要
- 複数のブラウザでテスト（Chrome、Firefox、Safari、Edge）
- モバイルデバイスでレスポンシブデザインをテスト
- 既存のコードスタイルに従う
- 新しいテキストを追加する際は3つの言語すべてに翻訳を追加

#### 繁體中文

- 保持簡單 - 不需要建置工具或框架
- 在多個瀏覽器測試（Chrome、Firefox、Safari、Edge）
- 在行動裝置上測試響應式設計
- 遵循現有的程式碼風格
- 新增文字時請為三種語言都新增翻譯

---

## Questions? / 質問? / 有問題？

Feel free to open an issue if you have any questions!

ご質問があればお気軽にIssueを開いてください！

如果有任何問題，歡迎開 Issue 詢問！

---

Forever Kanata / 永遠にかなた / 永遠的彼方
