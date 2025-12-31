/**
 * Danmaku (bullet comments) system for fan messages
 * Supports both Firestore and local JSON fallback
 */

const Danmaku = {
    data: null,
    container: null,
    tracks: [],
    trackCount: 5,
    isPaused: false,
    messageQueue: [],
    currentIndex: 0,
    animationInterval: null,
    baseSpeed: 15000, // Base duration in ms for message to cross screen
    useFirestore: false,
    unsubscribe: null, // Firestore listener
    selectedMessage: null, // Currently selected message for reporting

    async init() {
        this.container = document.getElementById('danmaku-container');
        if (!this.container) return;

        this.setupTracks();
        this.setupControls();

        // Check if Firebase is already initialized
        if (window.FirebaseApp && window.FirebaseApp.getDb()) {
            this.loadFromFirestore();
        } else {
            // Listen for Firebase ready event
            window.addEventListener('firebaseReady', () => {
                this.loadFromFirestore();
            });
        }

        // Also try loading from JSON as fallback
        setTimeout(() => {
            if (!this.useFirestore && !this.data) {
                this.loadFromJSON();
            }
        }, 2000);
    },

    async loadFromJSON() {
        try {
            const response = await fetch('memories/messages/messages.json');
            const jsonData = await response.json();

            // Convert JSON format to unified format
            this.data = {
                messages: jsonData.messages.map(msg => ({
                    id: msg.id,
                    author: msg.author,
                    content: msg.content, // Already has language keys
                    authorLink: msg.authorLink
                }))
            };

            this.start();
        } catch (error) {
            console.error('Failed to load messages from JSON:', error);
        }
    },

    async loadFromFirestore() {
        try {
            const db = window.FirebaseApp.getDb();
            if (!db) return;

            this.useFirestore = true;

            // Create report control now that Firestore is ready
            const controls = document.getElementById('danmaku-controls');
            if (controls && window.Report) {
                this.createReportControl(controls);
            }

            // Set up real-time listener
            this.unsubscribe = db.collection('messages')
                .orderBy('createdAt', 'desc')
                .limit(100)
                .onSnapshot((snapshot) => {
                    const messages = [];

                    snapshot.forEach(doc => {
                        const data = doc.data();
                        // Skip hidden content
                        if (data.hidden) return;

                        messages.push({
                            id: doc.id,
                            author: data.author,
                            content: data.content,
                            authorLink: data.authorLink,
                            authorAvatar: data.authorAvatar
                        });
                    });

                    this.data = { messages };

                    // Restart if already running
                    if (this.animationInterval) {
                        this.stop();
                    }
                    this.start();
                }, (error) => {
                    console.error('Firestore listener error:', error);
                    // Fall back to JSON
                    this.useFirestore = false;
                    this.loadFromJSON();
                });

        } catch (error) {
            console.error('Failed to set up Firestore:', error);
            this.loadFromJSON();
        }
    },

    setupTracks() {
        // Initialize track availability
        this.tracks = Array(this.trackCount).fill(0);

        // Create track container
        const trackContainer = document.createElement('div');
        trackContainer.className = 'danmaku-tracks';
        this.container.appendChild(trackContainer);
    },

    setupControls() {
        const controls = document.getElementById('danmaku-controls');
        if (!controls) return;

        const playPauseBtn = controls.querySelector('.danmaku-play-pause');
        if (playPauseBtn) {
            playPauseBtn.addEventListener('click', () => this.togglePause());
        }

        // Create report button (hidden by default)
        if (this.useFirestore && window.Report) {
            this.createReportControl(controls);
        }

        // Click outside to deselect
        document.addEventListener('click', (e) => {
            if (this.selectedMessage &&
                !e.target.closest('.danmaku-message') &&
                !e.target.closest('.danmaku-report-btn')) {
                this.deselectMessage();
            }
        });
    },

    createReportControl(controls) {
        // Check if already exists
        if (controls.querySelector('.danmaku-report-btn')) return;

        const reportBtn = document.createElement('button');
        reportBtn.className = 'danmaku-report-btn';
        reportBtn.style.display = 'none';
        reportBtn.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm0 12.5a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5zM8 4a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 8 4z"/>
            </svg>
        `;
        reportBtn.title = this.getReportLabel();
        reportBtn.addEventListener('click', () => this.reportSelectedMessage());
        controls.appendChild(reportBtn);
    },

    getReportLabel() {
        const labels = {
            'ja': '報告',
            'zh-TW': '檢舉',
            'en': 'Report'
        };
        const lang = (typeof i18n !== 'undefined') ? i18n.currentLang : 'en';
        return labels[lang] || labels['en'];
    },

    selectMessage(messageId, element) {
        // Deselect previous
        this.deselectMessage();

        this.selectedMessage = { id: messageId, element };
        element.classList.add('selected');
        element.style.animationPlayState = 'paused';

        // Show report button
        const reportBtn = document.querySelector('.danmaku-report-btn');
        if (reportBtn) {
            reportBtn.style.display = 'flex';
        }
    },

    deselectMessage() {
        if (this.selectedMessage) {
            this.selectedMessage.element.classList.remove('selected');
            if (!this.isPaused) {
                this.selectedMessage.element.style.animationPlayState = 'running';
            }
            this.selectedMessage = null;
        }

        // Hide report button
        const reportBtn = document.querySelector('.danmaku-report-btn');
        if (reportBtn) {
            reportBtn.style.display = 'none';
        }
    },

    async reportSelectedMessage() {
        if (!this.selectedMessage || !window.Report) return;

        await window.Report.handleReport(this.selectedMessage.id, 'message');
        this.deselectMessage();
    },

    start() {
        if (!this.data || !this.data.messages || this.data.messages.length === 0) {
            return;
        }

        // Shuffle messages for variety
        this.messageQueue = this.shuffleArray([...this.data.messages]);
        this.currentIndex = 0;

        // Dynamic interval based on message count to reduce repetition
        const messageCount = this.messageQueue.length;
        let interval;
        if (messageCount <= 3) {
            interval = 8000;  // Very few messages: 8 seconds
        } else if (messageCount <= 10) {
            interval = 5000;  // Few messages: 5 seconds
        } else if (messageCount <= 30) {
            interval = 3500;  // Medium: 3.5 seconds
        } else {
            interval = 2500;  // Many messages: 2.5 seconds
        }

        // Start spawning messages
        this.spawnMessage();
        this.animationInterval = setInterval(() => {
            if (!this.isPaused) {
                this.spawnMessage();
            }
        }, interval);
    },

    stop() {
        if (this.animationInterval) {
            clearInterval(this.animationInterval);
            this.animationInterval = null;
        }
    },

    togglePause() {
        this.isPaused = !this.isPaused;

        const btn = document.querySelector('.danmaku-play-pause');
        const danmakuElements = this.container.querySelectorAll('.danmaku-message');

        if (this.isPaused) {
            btn.textContent = '▶';
            btn.setAttribute('data-i18n', 'danmaku.play');
            danmakuElements.forEach(el => {
                el.style.animationPlayState = 'paused';
            });
        } else {
            btn.textContent = '⏸';
            btn.setAttribute('data-i18n', 'danmaku.pause');
            danmakuElements.forEach(el => {
                el.style.animationPlayState = 'running';
            });
        }
    },

    spawnMessage() {
        if (this.messageQueue.length === 0) return;

        const message = this.messageQueue[this.currentIndex];
        this.currentIndex++;

        // Re-shuffle when we've shown all messages (adds variety on each loop)
        if (this.currentIndex >= this.messageQueue.length) {
            this.currentIndex = 0;
            this.messageQueue = this.shuffleArray([...this.data.messages]);
        }

        // Find available track
        const now = Date.now();
        let trackIndex = -1;

        for (let i = 0; i < this.trackCount; i++) {
            if (this.tracks[i] <= now) {
                trackIndex = i;
                break;
            }
        }

        // If no track available, use the one that becomes free soonest
        if (trackIndex === -1) {
            trackIndex = this.tracks.indexOf(Math.min(...this.tracks));
        }

        // Create message element - show all messages regardless of language
        const content = message.content;

        // Skip if no content
        if (!content) return;

        const el = document.createElement('div');
        el.className = 'danmaku-message';
        el.style.setProperty('--track', trackIndex);

        // Store message ID for reporting
        if (message.id) {
            el.dataset.messageId = message.id;
        }

        el.innerHTML = `
            <span class="danmaku-author">${this.escapeHtml(message.author)}:</span>
            <span class="danmaku-text">${this.escapeHtml(content)}</span>
        `;

        // Click to select for reporting (only if using Firestore)
        if (this.useFirestore && message.id) {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                this.selectMessage(message.id, el);
            });
            el.style.cursor = 'pointer';
        }

        // Calculate animation duration based on content length
        const duration = this.baseSpeed + (content.length * 50);
        el.style.animationDuration = `${duration}ms`;

        // Reserve track
        this.tracks[trackIndex] = now + 4000; // 4 second gap between messages on same track

        // Add to container
        const trackContainer = this.container.querySelector('.danmaku-tracks');
        if (trackContainer) {
            trackContainer.appendChild(el);

            // Remove element after animation
            el.addEventListener('animationend', () => {
                // If this is the selected message, deselect it
                if (this.selectedMessage?.element === el) {
                    this.deselectMessage();
                }
                el.remove();
            });
        }
    },

    shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    },

    // Update messages when language changes
    onLanguageChange() {
        // Clear existing messages
        const trackContainer = this.container?.querySelector('.danmaku-tracks');
        if (trackContainer) {
            trackContainer.innerHTML = '';
        }
        // Reset tracks
        this.tracks = Array(this.trackCount).fill(0);
    },

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Cleanup when leaving page
    destroy() {
        this.stop();
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Danmaku.init();
});

// Update on language change (i18n dispatches on window)
window.addEventListener('languageChanged', () => {
    Danmaku.onLanguageChange();
});
