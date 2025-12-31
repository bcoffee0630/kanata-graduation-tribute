/**
 * Report Module
 * 檢舉模組 - 透過 GitHub Issue 檢舉不當內容
 * 自動隱藏功能 - 被檢舉 3 次後自動隱藏
 */

const Report = {
    // GitHub repo info
    repoOwner: 'bcoffee0630',
    repoName: 'kanata-graduation-tribute',

    // Firebase project ID for console links
    firebaseProjectId: 'kanata-memorial',

    init() {
        this.setupEventListeners();
    },

    setupEventListeners() {
        // Delegate click events for report buttons
        document.addEventListener('click', async (e) => {
            const reportBtn = e.target.closest('.report-btn');
            if (reportBtn) {
                const contentId = reportBtn.dataset.contentId;
                const contentType = reportBtn.dataset.contentType;
                await this.handleReport(contentId, contentType);
            }
        });
    },

    async handleReport(contentId, contentType) {
        if (!contentId || !contentType) {
            console.error('Missing content ID or type');
            return;
        }

        // Check if user is logged in
        const user = firebase.auth?.()?.currentUser;
        if (!user) {
            // Not logged in - just open the GitHub Issue
            this.openReport(contentId, contentType, null);
            return;
        }

        try {
            const db = window.FirebaseApp?.getDb();
            if (!db) {
                // No Firestore - just open the GitHub Issue
                this.openReport(contentId, contentType, null);
                return;
            }

            const collectionName = contentType === 'message' ? 'messages' : 'fanart';
            const docRef = db.collection(collectionName).doc(contentId);
            const doc = await docRef.get();

            if (!doc.exists) {
                console.error('Content not found');
                return;
            }

            const data = doc.data();

            // Check if user already reported this content
            if (data.reportedBy && data.reportedBy.includes(user.uid)) {
                const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';
                const messages = {
                    'ja': 'すでにこのコンテンツを報告しています',
                    'zh-TW': '您已經檢舉過此內容',
                    'en': 'You have already reported this content'
                };
                alert(messages[lang] || messages['en']);
                return;
            }

            // Update report count and add user to reportedBy
            const currentCount = data.reportCount || 0;
            const newCount = currentCount + 1;
            const shouldHide = newCount >= 3;

            await docRef.update({
                reportCount: firebase.firestore.FieldValue.increment(1),
                reportedBy: firebase.firestore.FieldValue.arrayUnion(user.uid),
                hidden: shouldHide
            });

            // Open GitHub Issue with content details
            this.openReport(contentId, contentType, data);

            // Show confirmation
            const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';
            const confirmMessages = {
                'ja': '報告を受け付けました。ご協力ありがとうございます。',
                'zh-TW': '已收到您的檢舉。感謝您的協助。',
                'en': 'Report submitted. Thank you for your help.'
            };
            alert(confirmMessages[lang] || confirmMessages['en']);

        } catch (error) {
            console.error('Failed to submit report:', error);
            // Still open GitHub Issue even if Firestore update fails
            this.openReport(contentId, contentType, null);
        }
    },

    openReport(contentId, contentType, contentData) {
        // Build GitHub Issue URL with pre-filled template
        const issueTitle = encodeURIComponent(
            `[Report] ${contentType === 'message' ? 'Message' : 'Fan Art'} - ${contentId}`
        );

        const issueBody = encodeURIComponent(this.buildIssueBody(contentId, contentType, contentData));

        // Use specific labels for content type
        const labels = `report:${contentType},report:pending`;

        const issueUrl = `https://github.com/${this.repoOwner}/${this.repoName}/issues/new?` +
            `title=${issueTitle}&body=${issueBody}&labels=${labels}`;

        // Open in new tab
        window.open(issueUrl, '_blank');
    },

    buildIssueBody(contentId, contentType, contentData) {
        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';
        const collectionName = contentType === 'message' ? 'messages' : 'fanart';

        // Firebase Console direct link
        const consoleLink = `https://console.firebase.google.com/project/${this.firebaseProjectId}/firestore/data/~2F${collectionName}~2F${contentId}`;

        // Content preview (if available)
        let contentPreview = '';
        if (contentData) {
            if (contentType === 'message') {
                contentPreview = contentData.content ? `> ${contentData.content.substring(0, 200)}${contentData.content.length > 200 ? '...' : ''}` : '';
            } else {
                contentPreview = contentData.caption ? `> ${contentData.caption.substring(0, 200)}${contentData.caption.length > 200 ? '...' : ''}` : '';
            }
        }

        // Author info
        const authorInfo = contentData?.author || 'Unknown';

        const templates = {
            'ja': `## 報告内容

**コンテンツID:** \`${contentId}\`
**コンテンツタイプ:** ${contentType === 'message' ? 'メッセージ' : 'ファンアート'}
**投稿者:** ${authorInfo}

### Firebase Console
[コンテンツを確認](${consoleLink})

### コンテンツプレビュー
${contentPreview || '*プレビューなし*'}

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
**投稿者:** ${authorInfo}

### Firebase Console
[查看內容](${consoleLink})

### 內容預覽
${contentPreview || '*無預覽*'}

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
**Author:** ${authorInfo}

### Firebase Console
[View Content](${consoleLink})

### Content Preview
${contentPreview || '*No preview available*'}

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
