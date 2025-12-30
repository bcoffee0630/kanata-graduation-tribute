/**
 * Gallery functionality for fan art display
 * Supports both Firestore and local JSON fallback
 * With pagination (Load More button)
 */

const Gallery = {
    data: null,
    container: null,
    lightbox: null,
    loadMoreBtn: null,
    currentIndex: 0,
    useFirestore: false,
    unsubscribe: null,

    // Pagination settings
    PAGE_SIZE: 20,
    lastDoc: null,
    hasMore: true,
    isLoading: false,

    async init() {
        this.container = document.getElementById('gallery-grid');
        this.lightbox = document.getElementById('lightbox');
        this.loadMoreBtn = document.getElementById('load-more-btn');

        if (!this.container) return;

        this.setupLightbox();
        this.setupLoadMoreButton();

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

    setupLoadMoreButton() {
        if (!this.loadMoreBtn) return;

        this.loadMoreBtn.addEventListener('click', () => {
            this.loadMore();
        });
    },

    async loadFromJSON() {
        try {
            const response = await fetch('memories/fanart/index.json');
            const jsonData = await response.json();

            this.data = {
                fanart: jsonData.fanart.map(item => ({
                    id: item.id || item.path,
                    artist: item.artist,
                    artistLink: item.artistLink,
                    path: item.path,
                    imageUrl: item.path, // Use same path for local files
                    caption: item.caption,
                    date: item.date,
                    isOfficial: item.isOfficial
                }))
            };

            this.render();
            this.setupLazyLoading();
        } catch (error) {
            console.error('Failed to load gallery from JSON:', error);
            this.container.innerHTML = `<p class="no-content" data-i18n="gallery.no_content">まだ投稿がありません</p>`;
        }
    },

    async loadFromFirestore() {
        try {
            const db = window.FirebaseApp.getDb();
            if (!db) return;

            this.useFirestore = true;
            this.isLoading = true;

            // Initial load with pagination
            const snapshot = await db.collection('fanart')
                .orderBy('createdAt', 'desc')
                .limit(this.PAGE_SIZE)
                .get();

            const fanart = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // Skip hidden content
                if (data.hidden) return;

                fanart.push({
                    id: doc.id,
                    artist: data.artist,
                    artistLink: data.artistLink,
                    artistAvatar: data.artistAvatar,
                    path: data.imagePath,
                    imageUrl: data.imageUrl,
                    caption: data.caption,
                    date: data.createdAt?.toDate?.()?.toLocaleDateString() || '',
                    isOfficial: false
                });
            });

            // Track pagination state
            if (snapshot.docs.length > 0) {
                this.lastDoc = snapshot.docs[snapshot.docs.length - 1];
            }
            this.hasMore = snapshot.docs.length === this.PAGE_SIZE;

            this.data = { fanart };
            this.render();
            this.setupLazyLoading();
            this.updateLoadMoreButton();
            this.isLoading = false;

        } catch (error) {
            console.error('Failed to load from Firestore:', error);
            this.isLoading = false;
            this.loadFromJSON();
        }
    },

    async loadMore() {
        if (!this.hasMore || this.isLoading || !this.lastDoc) return;

        const db = window.FirebaseApp?.getDb();
        if (!db) return;

        this.isLoading = true;
        if (this.loadMoreBtn) {
            this.loadMoreBtn.disabled = true;
        }

        try {
            const snapshot = await db.collection('fanart')
                .orderBy('createdAt', 'desc')
                .startAfter(this.lastDoc)
                .limit(this.PAGE_SIZE)
                .get();

            const newFanart = [];
            snapshot.forEach(doc => {
                const data = doc.data();
                // Skip hidden content
                if (data.hidden) return;

                newFanart.push({
                    id: doc.id,
                    artist: data.artist,
                    artistLink: data.artistLink,
                    artistAvatar: data.artistAvatar,
                    path: data.imagePath,
                    imageUrl: data.imageUrl,
                    caption: data.caption,
                    date: data.createdAt?.toDate?.()?.toLocaleDateString() || '',
                    isOfficial: false
                });
            });

            // Update pagination state
            if (snapshot.docs.length > 0) {
                this.lastDoc = snapshot.docs[snapshot.docs.length - 1];
            }
            this.hasMore = snapshot.docs.length === this.PAGE_SIZE;

            // Append new items
            if (newFanart.length > 0) {
                this.data.fanart = [...this.data.fanart, ...newFanart];
                this.appendItems(newFanart);
                this.setupLazyLoading();
            }

            this.updateLoadMoreButton();

        } catch (error) {
            console.error('Failed to load more:', error);
        } finally {
            this.isLoading = false;
            if (this.loadMoreBtn) {
                this.loadMoreBtn.disabled = false;
            }
        }
    },

    appendItems(items) {
        const startIndex = this.data.fanart.length - items.length;

        const html = items.map((item, i) => {
            const index = startIndex + i;
            const imageSrc = item.imageUrl || item.path;
            const caption = item.caption || '';
            const artist = this.escapeHtml(item.artist || 'Anonymous');

            // Report button (only for Firestore entries)
            let reportBtn = '';
            if (this.useFirestore && window.Report && item.id) {
                reportBtn = window.Report.createReportButton(item.id, 'fanart');
            }

            return `
                <div class="gallery-item" data-index="${index}">
                    <img
                        data-src="${imageSrc}"
                        alt="${this.escapeHtml(caption)}"
                        class="gallery-image lazy"
                        loading="lazy"
                    >
                    <div class="gallery-overlay">
                        <p class="gallery-artist">
                            ${item.artistLink
                                ? `<a href="${this.escapeHtml(item.artistLink)}" target="_blank" rel="noopener">${artist}</a>`
                                : artist}
                            ${item.isOfficial ? '<span class="official-badge">Official</span>' : ''}
                        </p>
                        <p class="gallery-caption">${this.escapeHtml(caption)}</p>
                        ${reportBtn}
                    </div>
                </div>
            `;
        }).join('');

        this.container.insertAdjacentHTML('beforeend', html);

        // Add click handlers for new items
        const newItems = this.container.querySelectorAll('.gallery-item:not([data-bound])');
        newItems.forEach(item => {
            item.setAttribute('data-bound', 'true');
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'A' && !e.target.closest('.report-btn')) {
                    this.openLightbox(parseInt(item.dataset.index));
                }
            });
        });
    },

    updateLoadMoreButton() {
        if (!this.loadMoreBtn) return;
        this.loadMoreBtn.style.display = this.hasMore ? 'block' : 'none';
    },

    render() {
        if (!this.data || !this.data.fanart || this.data.fanart.length === 0) {
            this.container.innerHTML = `<p class="no-content" data-i18n="gallery.no_content">まだ投稿がありません</p>`;
            if (window.i18n) i18n.updatePageContent();
            return;
        }

        this.container.innerHTML = this.data.fanart.map((item, index) => {
            const imageSrc = item.imageUrl || item.path;
            const caption = item.caption || '';
            const artist = this.escapeHtml(item.artist || 'Anonymous');

            // Report button (only for Firestore entries)
            let reportBtn = '';
            if (this.useFirestore && window.Report && item.id) {
                reportBtn = window.Report.createReportButton(item.id, 'fanart');
            }

            return `
                <div class="gallery-item" data-index="${index}">
                    <img
                        data-src="${imageSrc}"
                        alt="${this.escapeHtml(caption)}"
                        class="gallery-image lazy"
                        loading="lazy"
                    >
                    <div class="gallery-overlay">
                        <p class="gallery-artist">
                            ${item.artistLink
                                ? `<a href="${this.escapeHtml(item.artistLink)}" target="_blank" rel="noopener">${artist}</a>`
                                : artist}
                            ${item.isOfficial ? '<span class="official-badge">Official</span>' : ''}
                        </p>
                        <p class="gallery-caption">${this.escapeHtml(caption)}</p>
                        ${reportBtn}
                    </div>
                </div>
            `;
        }).join('');

        // Add click handlers
        this.container.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'A' && !e.target.closest('.report-btn')) {
                    this.openLightbox(parseInt(item.dataset.index));
                }
            });
        });
    },

    setupLazyLoading() {
        const images = this.container.querySelectorAll('img.lazy');

        if ('IntersectionObserver' in window) {
            const imageObserver = new IntersectionObserver((entries) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        img.src = img.dataset.src;
                        img.classList.remove('lazy');
                        imageObserver.unobserve(img);
                    }
                });
            }, { rootMargin: '50px' });

            images.forEach(img => imageObserver.observe(img));
        } else {
            // Fallback for older browsers
            images.forEach(img => {
                img.src = img.dataset.src;
                img.classList.remove('lazy');
            });
        }
    },

    setupLightbox() {
        if (!this.lightbox) return;

        // Close on background click
        this.lightbox.addEventListener('click', (e) => {
            if (e.target === this.lightbox || e.target.classList.contains('lightbox-close')) {
                this.closeLightbox();
            }
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (!this.lightbox.classList.contains('active')) return;

            switch(e.key) {
                case 'Escape':
                    this.closeLightbox();
                    break;
                case 'ArrowLeft':
                    this.navigate(-1);
                    break;
                case 'ArrowRight':
                    this.navigate(1);
                    break;
            }
        });

        // Navigation buttons
        this.lightbox.querySelector('.lightbox-prev')?.addEventListener('click', () => this.navigate(-1));
        this.lightbox.querySelector('.lightbox-next')?.addEventListener('click', () => this.navigate(1));
    },

    openLightbox(index) {
        if (!this.lightbox || !this.data) return;

        this.currentIndex = index;
        this.updateLightboxContent();
        this.lightbox.classList.add('active');
        document.body.style.overflow = 'hidden';
    },

    closeLightbox() {
        if (!this.lightbox) return;

        this.lightbox.classList.remove('active');
        document.body.style.overflow = '';
    },

    navigate(direction) {
        const total = this.data.fanart.length;
        this.currentIndex = (this.currentIndex + direction + total) % total;
        this.updateLightboxContent();
    },

    updateLightboxContent() {
        const item = this.data.fanart[this.currentIndex];

        const imgContainer = this.lightbox.querySelector('.lightbox-image');
        const infoContainer = this.lightbox.querySelector('.lightbox-info');

        const imageSrc = item.imageUrl || item.path;
        const caption = item.caption || '';
        const artist = this.escapeHtml(item.artist || 'Anonymous');

        if (imgContainer) {
            imgContainer.innerHTML = `<img src="${imageSrc}" alt="${this.escapeHtml(caption)}">`;
        }

        if (infoContainer) {
            infoContainer.innerHTML = `
                <p class="lightbox-artist">
                    ${item.artistLink
                        ? `<a href="${this.escapeHtml(item.artistLink)}" target="_blank" rel="noopener">${artist}</a>`
                        : artist}
                    ${item.isOfficial ? '<span class="official-badge">Official</span>' : ''}
                </p>
                <p class="lightbox-caption">${this.escapeHtml(caption)}</p>
                <p class="lightbox-date">${item.date || ''}</p>
            `;
        }

        // Update navigation visibility
        const prevBtn = this.lightbox.querySelector('.lightbox-prev');
        const nextBtn = this.lightbox.querySelector('.lightbox-next');
        const showNav = this.data.fanart.length > 1;
        if (prevBtn) prevBtn.style.display = showNav ? '' : 'none';
        if (nextBtn) nextBtn.style.display = showNav ? '' : 'none';
    },

    // Update gallery when language changes
    onLanguageChange() {
        this.render();
        this.setupLazyLoading();
        if (this.lightbox?.classList.contains('active')) {
            this.updateLightboxContent();
        }
    },

    // Escape HTML to prevent XSS
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Cleanup when leaving page
    destroy() {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }
};

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    Gallery.init();
});

// Update on language change
document.addEventListener('languageChanged', () => {
    Gallery.onLanguageChange();
});
