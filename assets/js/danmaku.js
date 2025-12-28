/**
 * Danmaku (bullet comments) system for fan messages
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

    async init() {
        this.container = document.getElementById('danmaku-container');
        if (!this.container) return;

        try {
            const response = await fetch('memories/messages/messages.json');
            this.data = await response.json();
            this.setupTracks();
            this.setupControls();
            this.start();
        } catch (error) {
            console.error('Failed to load messages:', error);
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
    },

    start() {
        if (!this.data || !this.data.messages || this.data.messages.length === 0) {
            return;
        }

        // Shuffle messages for variety
        this.messageQueue = this.shuffleArray([...this.data.messages]);
        this.currentIndex = 0;

        // Start spawning messages
        this.spawnMessage();
        this.animationInterval = setInterval(() => {
            if (!this.isPaused) {
                this.spawnMessage();
            }
        }, 3000); // New message every 3 seconds
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
        this.currentIndex = (this.currentIndex + 1) % this.messageQueue.length;

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

        // Create message element
        const lang = window.i18n ? i18n.currentLang : 'ja';
        const content = message.content[lang] || message.content.ja;

        const el = document.createElement('div');
        el.className = 'danmaku-message';
        el.style.setProperty('--track', trackIndex);
        el.innerHTML = `
            <span class="danmaku-author">${message.author}:</span>
            <span class="danmaku-text">${content}</span>
        `;

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
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Danmaku.init();
});

// Update on language change
document.addEventListener('languageChanged', () => {
    Danmaku.onLanguageChange();
});
