/**
 * Authenticated reports are stored privately for administrator review.
 * Anonymous visitors keep the existing GitHub Issue fallback.
 */

const Report = {
    repoOwner: 'bcoffee0630',
    repoName: 'kanata-graduation-tribute',
    selected: null,
    isSubmitting: false,

    copy: {
        'ja': {
            title: 'コンテンツを報告', reason: '報告理由', choose: '選択してください',
            inappropriate: '不適切なコンテンツ', spam: 'スパム', copyright: '著作権侵害',
            harassment: 'ハラスメント', other: 'その他', details: '詳細説明',
            privacy: '報告内容とアカウント情報は管理者のみ確認できます。', cancel: 'キャンセル',
            submit: '報告を送信', submitting: '送信中...', success: '報告を受け付けました。',
            autoHidden: '報告を受け付け、コンテンツを審査のため一時非表示にしました。',
            duplicate: 'このコンテンツはすでに報告済みです。', own: '自分の投稿は報告できません。',
            restricted: 'このアカウントは現在報告できません。', error: '報告を送信できませんでした。',
            maintenance: 'メンテナンス中のため、現在は報告できません。', burst: '操作が多すぎます。少し待ってからお試しください。',
            message: 'メッセージ', fanart: 'ファンアート'
        },
        'zh-TW': {
            title: '檢舉內容', reason: '檢舉原因', choose: '請選擇',
            inappropriate: '不當內容', spam: '垃圾訊息', copyright: '侵犯版權',
            harassment: '騷擾', other: '其他', details: '詳細說明',
            privacy: '檢舉內容與帳號資訊僅供管理員查閱。', cancel: '取消',
            submit: '送出檢舉', submitting: '送出中...', success: '已收到您的檢舉。',
            autoHidden: '已收到檢舉，內容已暫時隱藏並送交管理員審查。',
            duplicate: '您已檢舉過此內容。', own: '無法檢舉自己的投稿。',
            restricted: '此帳號目前無法送出檢舉。', maintenance: '網站維護中，目前無法送出檢舉。', burst: '操作過於頻繁，請稍後再試。',
            error: '無法送出檢舉。', message: '留言', fanart: '創作'
        },
        'en': {
            title: 'Report content', reason: 'Report reason', choose: 'Choose a reason',
            inappropriate: 'Inappropriate content', spam: 'Spam', copyright: 'Copyright infringement',
            harassment: 'Harassment', other: 'Other', details: 'Additional details',
            privacy: 'Only administrators can view your report and account information.', cancel: 'Cancel',
            submit: 'Submit report', submitting: 'Submitting...', success: 'Your report was submitted.',
            autoHidden: 'Your report was submitted and the content was temporarily hidden for review.',
            duplicate: 'You already reported this content.', own: 'You cannot report your own content.',
            restricted: 'This account cannot submit reports right now.',
            maintenance: 'The site is under maintenance and is temporarily read-only.', burst: 'Too many attempts. Please wait a moment and try again.',
            error: 'The report could not be submitted.',
            message: 'Message', fanart: 'Fan art'
        }
    },

    init() {
        document.addEventListener('click', (event) => {
            const reportButton = event.target.closest('.report-btn');
            if (reportButton) {
                this.handleReport(reportButton.dataset.contentId, reportButton.dataset.contentType);
            }

            if (event.target.closest('.report-modal-close')) this.closeModal();
            if (event.target.id === 'report-modal') this.closeModal();
        });

        document.getElementById('report-form')?.addEventListener('submit', (event) => {
            this.submit(event);
        });
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') this.closeModal();
        });
        window.addEventListener('languageChanged', () => this.applyModalLanguage());
        this.applyModalLanguage();
    },

    language() {
        return (typeof i18n !== 'undefined' && i18n.currentLang) || 'en';
    },

    labels() {
        return this.copy[this.language()] || this.copy.en;
    },

    applyModalLanguage() {
        const labels = this.labels();
        const setText = (id, value) => {
            const element = document.getElementById(id);
            if (element) element.textContent = value;
        };
        setText('report-modal-title', labels.title);
        setText('report-reason-label', labels.reason);
        setText('report-details-label', labels.details);
        setText('report-privacy-note', labels.privacy);
        setText('report-submit', labels.submit);
        const cancel = document.querySelector('#report-modal .secondary-btn');
        if (cancel) cancel.textContent = labels.cancel;
        const close = document.querySelector('#report-modal .modal-header .report-modal-close');
        if (close) close.setAttribute('aria-label', labels.cancel);

        const reason = document.getElementById('report-reason');
        if (reason) {
            const optionKeys = ['choose', 'inappropriate', 'spam', 'copyright', 'harassment', 'other'];
            [...reason.options].forEach((option, index) => {
                option.textContent = labels[optionKeys[index]] || option.textContent;
            });
        }
        if (this.selected) this.updateTargetLabel();
    },

    async handleReport(contentId, contentType) {
        if (!contentId || !['message', 'fanart'].includes(contentType)) return;
        const user = window.FirebaseApp?.getAuth()?.currentUser;
        if (!user) {
            this.openGitHubFallback(contentId, contentType);
            return;
        }

        this.selected = { contentId, contentType };
        this.updateTargetLabel();
        const modal = document.getElementById('report-modal');
        modal?.classList.add('active');
        modal?.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        document.getElementById('report-reason')?.focus();
    },

    updateTargetLabel() {
        if (!this.selected) return;
        const labels = this.labels();
        const typeLabel = this.selected.contentType === 'message' ? labels.message : labels.fanart;
        const target = document.getElementById('report-target-label');
        if (target) target.textContent = `${typeLabel} · ${this.selected.contentId}`;
    },

    closeModal() {
        const modal = document.getElementById('report-modal');
        if (!modal?.classList.contains('active')) return;
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        document.getElementById('report-form')?.reset();
        this.selected = null;
    },

    async submit(event) {
        event.preventDefault();
        if (!this.selected || this.isSubmitting) return;
        const labels = this.labels();
        const submitButton = document.getElementById('report-submit');
        const reason = document.getElementById('report-reason')?.value || '';
        const details = document.getElementById('report-details')?.value.trim() || '';

        this.isSubmitting = true;
        submitButton.disabled = true;
        submitButton.textContent = labels.submitting;

        try {
            const submitReport = window.FirebaseApp.getFunctions().httpsCallable('submitReport');
            const result = await submitReport({
                contentId: this.selected.contentId,
                contentType: this.selected.contentType,
                reason,
                details
            });
            const message = result.data.autoHidden ? labels.autoHidden : labels.success;
            if (typeof Toast !== 'undefined') Toast.success(message); else alert(message);
            this.closeModal();
        } catch (error) {
            const code = String(error.code || '');
            let message = labels.error;
            if (code.includes('already-exists')) message = labels.duplicate;
            if (code.includes('failed-precondition') && String(error.message).includes('own')) message = labels.own;
            if (code.includes('permission-denied')) message = labels.restricted;
            if (code.includes('unavailable')) message = labels.maintenance;
            if (error.details?.reason === 'burst_limit') message = labels.burst;
            if (typeof Toast !== 'undefined') Toast.error(message); else alert(message);
            console.error('Report submission failed:', error);
        } finally {
            this.isSubmitting = false;
            submitButton.disabled = false;
            submitButton.textContent = labels.submit;
        }
    },

    openGitHubFallback(contentId, contentType) {
        const typeLabel = contentType === 'message' ? 'Message' : 'Fan Art';
        const projectId = window.FirebaseApp?.getProjectId?.() || 'kanata-memorial';
        const collection = contentType === 'message' ? 'messages' : 'fanart';
        const consoleUrl = `https://console.firebase.google.com/project/${projectId}/firestore/data/~2F${collection}~2F${contentId}`;
        const title = encodeURIComponent(`[Report] ${typeLabel} - ${contentId}`);
        const body = encodeURIComponent(
            `## Report Details\n\n**Content ID:** \`${contentId}\`\n` +
            `**Content Type:** ${typeLabel}\n\n` +
            `### Firebase Console\n[View content](${consoleUrl})\n\n` +
            `### Reason\n<!-- Please explain why you are reporting this content. -->\n`
        );
        const labels = encodeURIComponent(`report:${contentType},report:pending`);
        const url = `https://github.com/${this.repoOwner}/${this.repoName}/issues/new?title=${title}&body=${body}&labels=${labels}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    },

    escapeAttribute(value) {
        return String(value).replace(/[&<>'"]/g, (character) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        })[character]);
    },

    createReportButton(contentId, contentType) {
        const label = this.escapeAttribute(this.labels().title);
        const safeContentId = this.escapeAttribute(contentId);
        const safeContentType = this.escapeAttribute(contentType);
        return `<button class="report-btn" data-content-id="${safeContentId}" data-content-type="${safeContentType}" title="${label}" aria-label="${label}">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM8 4a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8 4z"/>
            </svg>
        </button>`;
    }
};

Report.init();
window.Report = Report;
