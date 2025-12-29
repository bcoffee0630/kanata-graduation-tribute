/**
 * Report Module
 * 檢舉模組 - 透過 GitHub Issue 檢舉不當內容
 */

const Report = {
    // GitHub repo info
    repoOwner: 'bcoffee0630',
    repoName: 'kanata-graduation-tribute',

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Delegate click events for report buttons
        document.addEventListener('click', (e) => {
            const reportBtn = e.target.closest('.report-btn');
            if (reportBtn) {
                const contentId = reportBtn.dataset.contentId;
                const contentType = reportBtn.dataset.contentType;
                this.openReport(contentId, contentType);
            }
        });
    },

    openReport(contentId, contentType) {
        if (!contentId || !contentType) {
            console.error('Missing content ID or type');
            return;
        }

        // Build GitHub Issue URL with pre-filled template
        const issueTitle = encodeURIComponent(
            `[Report] ${contentType === 'message' ? 'Message' : 'Fan Art'} - ${contentId}`
        );

        const issueBody = encodeURIComponent(this.buildIssueBody(contentId, contentType));

        const issueUrl = `https://github.com/${this.repoOwner}/${this.repoName}/issues/new?` +
            `title=${issueTitle}&body=${issueBody}&labels=report,pending-review`;

        // Open in new tab
        window.open(issueUrl, '_blank');
    },

    buildIssueBody(contentId, contentType) {
        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';

        const templates = {
            'ja': `## 報告内容

**コンテンツID:** \`${contentId}\`
**コンテンツタイプ:** ${contentType === 'message' ? 'メッセージ' : 'ファンアート'}

---

### 報告理由
<!-- 以下から選択してください -->
- [ ] 不適切なコンテンツ
- [ ] スパム
- [ ] 著作権侵害
- [ ] その他

### 詳細説明
<!-- なぜこのコンテンツを報告するのか、詳しく説明してください -->



---
*この Issue は自動生成されました*`,

            'zh-TW': `## 檢舉內容

**內容ID:** \`${contentId}\`
**內容類型:** ${contentType === 'message' ? '留言' : '繪圖'}

---

### 檢舉原因
<!-- 請選擇適用的項目 -->
- [ ] 不當內容
- [ ] 垃圾訊息
- [ ] 侵犯版權
- [ ] 其他

### 詳細說明
<!-- 請說明為什麼要檢舉此內容 -->



---
*此 Issue 由系統自動產生*`,

            'en': `## Report Details

**Content ID:** \`${contentId}\`
**Content Type:** ${contentType === 'message' ? 'Message' : 'Fan Art'}

---

### Reason for Report
<!-- Please select applicable options -->
- [ ] Inappropriate content
- [ ] Spam
- [ ] Copyright infringement
- [ ] Other

### Additional Details
<!-- Please explain why you are reporting this content -->



---
*This Issue was auto-generated*`
        };

        return templates[lang] || templates['en'];
    },

    // Create report button HTML
    createReportButton(contentId, contentType) {
        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';

        const labels = {
            'ja': '報告',
            'zh-TW': '檢舉',
            'en': 'Report'
        };

        return `<button class="report-btn" data-content-id="${contentId}" data-content-type="${contentType}" title="${labels[lang] || labels['en']}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM8 4a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8 4z"/>
            </svg>
        </button>`;
    }
};

// Initialize
Report.init();

// Export
window.Report = Report;
