# 天音かなた卒業記念サイト | 天音彼方畢業紀念網站 | Amane Kanata Memorial

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Graduation Date](https://img.shields.io/badge/Graduated-2025.12.27-blue)](https://www.youtube.com/channel/UCZlDXzGoo7d44bwdNObFacg)

A community-driven memorial website for Amane Kanata, celebrating her journey and preserving memories forever.

**Live Site**: [https://bcoffee0630.github.io/kanata-graduation-tribute/](https://bcoffee0630.github.io/kanata-graduation-tribute/)

---

**Language / 言語 / 語言:**
[日本語](#日本語) | [繁體中文](#繁體中文) | [English](#english)

---

<a id="日本語"></a>
## 日本語

### このプロジェクトについて
2025年12月27日に卒業した天音かなたさんのためのファンメモリアルサイトです。鈴原るるさんのファンが毎日ツイートで卒業後の日数を記録していたことに触発されて作られました。

### 機能
- 卒業からの日数カウンター
- ファンメッセージ（弾幕風表示）
- ファンアートギャラリー
- 多言語対応（日本語、繁体中文、英語）
- GitHub PRによるコミュニティ投稿

---

### ファンアートの投稿方法

#### 手順
1. このリポジトリをフォーク
2. 画像を `memories/fanart/images/` に追加
3. `memories/fanart/index.json` にエントリを追加:

```json
{
  "id": "XXX",
  "filename": "your-image.png",
  "path": "memories/fanart/images/your-image.png",
  "artist": "あなたの名前",
  "artistLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "isOfficial": false,
  "caption": {
    "ja": "作品の説明",
    "zh-TW": "作品說明",
    "en": "Description"
  }
}
```

4. Pull Requestを作成

#### 画像規格
| 項目 | 要件 |
|------|------|
| 形式 | PNG または JPG |
| サイズ | 2MB以下 |
| 解像度 | 1920x1080 推奨 |

---

### メッセージの投稿方法

1. このリポジトリをフォーク
2. `memories/messages/messages.json` にエントリを追加:

```json
{
  "id": "XXX",
  "author": "あなたの名前",
  "authorLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "content": {
    "ja": "日本語のメッセージ",
    "zh-TW": "中文訊息（可選）",
    "en": "English message (optional)"
  }
}
```

3. Pull Requestを作成

**注意:** 少なくとも1つの言語で記入してください。

---

### 著作権について

- 投稿するファンアートは**自分のオリジナル作品**であるか、**著作権者から許可を得た**ものである必要があります
- 投稿することで、このメモリアルサイトでの表示に同意したものとみなされます
- hololive/COVER Corp.の公式素材は適切にクレジットを記載してください

---

<a id="繁體中文"></a>
## 繁體中文

### 關於此專案
這是為了紀念2025年12月27日畢業的天音彼方所建立的粉絲紀念網站。靈感來自於鈴原露露的粉絲每天在推特發文記錄畢業後天數的做法。

### 功能特色
- 畢業天數計數器
- 粉絲留言（彈幕風格顯示）
- 粉絲繪圖畫廊
- 多語言支援（日文、繁體中文、英文）
- 透過 GitHub PR 進行社群投稿

---

### 如何投稿繪圖

#### 步驟
1. Fork 此專案
2. 將圖片新增至 `memories/fanart/images/`
3. 在 `memories/fanart/index.json` 新增條目：

```json
{
  "id": "XXX",
  "filename": "your-image.png",
  "path": "memories/fanart/images/your-image.png",
  "artist": "您的名稱",
  "artistLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "isOfficial": false,
  "caption": {
    "ja": "作品說明（日文）",
    "zh-TW": "作品說明",
    "en": "Description"
  }
}
```

4. 建立 Pull Request

#### 圖片規格
| 項目 | 要求 |
|------|------|
| 格式 | PNG 或 JPG |
| 大小 | 2MB 以下 |
| 解析度 | 建議 1920x1080 |

---

### 如何投稿留言

1. Fork 此專案
2. 在 `memories/messages/messages.json` 新增條目：

```json
{
  "id": "XXX",
  "author": "您的名稱",
  "authorLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "content": {
    "ja": "日文訊息（可選）",
    "zh-TW": "中文訊息",
    "en": "English message (optional)"
  }
}
```

3. 建立 Pull Request

**注意：** 請至少提供一種語言的內容。

---

### 版權聲明

- 投稿的繪圖必須是**您的原創作品**，或是**已獲得版權所有者授權**的作品
- 投稿即表示您同意將作品展示於此紀念網站
- 使用 hololive/COVER Corp. 的官方素材請標註適當的來源

---

<a id="english"></a>
## English

### About This Project
A fan memorial website for Amane Kanata who graduated on December 27, 2025. Inspired by a fan of Suzuhara Lulu who posted daily on Twitter counting the days since graduation.

### Features
- Days since graduation counter
- Fan messages (danmaku-style display)
- Fan art gallery
- Multi-language support (Japanese, Traditional Chinese, English)
- Community submissions via GitHub PR

---

### How to Submit Fan Art

#### Steps
1. Fork this repository
2. Add your image to `memories/fanart/images/`
3. Add an entry to `memories/fanart/index.json`:

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
    "ja": "Japanese description",
    "zh-TW": "Chinese description",
    "en": "English description"
  }
}
```

4. Create a Pull Request

#### Image Guidelines
| Item | Requirement |
|------|-------------|
| Format | PNG or JPG |
| Size | Under 2MB |
| Resolution | 1920x1080 recommended |

---

### How to Submit a Message

1. Fork this repository
2. Add an entry to `memories/messages/messages.json`:

```json
{
  "id": "XXX",
  "author": "Your Name",
  "authorLink": "https://twitter.com/yourhandle",
  "date": "YYYY-MM-DD",
  "content": {
    "ja": "Japanese message (optional)",
    "zh-TW": "Chinese message (optional)",
    "en": "Your message"
  }
}
```

3. Create a Pull Request

**Note:** Please provide content in at least one language.

---

### Copyright Notice

- Fan art submissions must be **your original work** or **authorized by the copyright holder**
- By submitting, you agree to have your work displayed on this memorial site
- Please credit hololive/COVER Corp. appropriately when using official materials

---

## Technical Stack

- HTML5 / CSS3 / Vanilla JavaScript
- GitHub Pages
- No framework dependencies

## Project Structure

```
kanata-graduation-tribute/
├── index.html
├── assets/
│   ├── css/          # Stylesheets
│   ├── js/           # JavaScript
│   └── locales/      # Translation files
├── memories/
│   ├── fanart/       # Fan art submissions
│   └── messages/     # Fan messages
└── images/           # Site images
```

## License

MIT License - See [LICENSE](LICENSE) file for details

## Credits

- Header Image: [誰も見てない夢を見ろ - 天音かなた](https://www.youtube.com/watch?v=IdXhY6zGC4s)
- Background: [天音かなた卒業ライブ](https://www.youtube.com/watch?v=8iGGL_0CEpc)
- Icons: [Freepik - Flaticon](https://www.flaticon.com/)

---

## 開発について | Development | 開發說明

このウェブサイトは [Claude Code](https://claude.com/claude-code) を使用して開発されました。

This website was developed with the assistance of [Claude Code](https://claude.com/claude-code).

此網站使用 [Claude Code](https://claude.com/claude-code) 協助開發。

---

## 素材の著作権 | Asset Copyright | 素材版權聲明

### 日本語
- 当サイトで使用している画像・動画のスクリーンショットは、**hololive プロダクション / COVER株式会社** に帰属します
- ファンアートの著作権は各アーティストに帰属します
- 当サイトは非公式のファンプロジェクトであり、COVER株式会社とは一切関係ありません

### English
- Screenshots of images and videos used on this site belong to **hololive production / COVER Corporation**
- Fan art copyrights belong to their respective artists
- This is an unofficial fan project and is not affiliated with COVER Corporation

### 繁體中文
- 本站使用的圖片及影片截圖版權歸屬於 **hololive production / COVER 株式會社**
- 粉絲繪圖的版權歸屬於各創作者
- 本站為非官方粉絲專案，與 COVER 株式會社無任何關聯

---

## 免責事項 | Disclaimer | 免責聲明

### 日本語
このウェブサイトはファンによる追悼目的のみで作成されており、商業目的はありません。著作権侵害等の懸念がある場合は、Issueまたはメールにてご連絡ください。速やかに対応いたします。

### English
This website was created solely for fan memorial purposes and has no commercial intent. If you have any concerns regarding copyright infringement or other issues, please contact us via Issue or email. We will respond promptly.

### 繁體中文
本網站僅為粉絲紀念用途而建立，不具任何商業目的。若有任何侵權疑慮或其他問題，請透過 Issue 或電子郵件聯繫我們，我們將盡速處理。

**Contact / 聯絡方式:** [GitHub Issues](https://github.com/bcoffee0630/kanata-graduation-tribute/issues)

---

**Forever Kanata | 永遠にかなた | 永遠的彼方**
