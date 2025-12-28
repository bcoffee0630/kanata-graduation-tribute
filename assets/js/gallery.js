/**
 * Gallery functionality for fan art display
 */

const Gallery = {
    data: null,
    container: null,
    lightbox: null,
    currentIndex: 0,

    async init() {
        this.container = document.getElementById('gallery-grid');
        this.lightbox = document.getElementById('lightbox');

        if (!this.container) return;

        try {
            const response = await fetch('memories/fanart/index.json');
            this.data = await response.json();
            this.render();
            this.setupLightbox();
            this.setupLazyLoading();
        } catch (error) {
            console.error('Failed to load gallery data:', error);
        }
    },

    render() {
        if (!this.data || !this.data.fanart || this.data.fanart.length === 0) {
            this.container.innerHTML = `<p class="no-content" data-i18n="gallery.no_content">まだ投稿がありません</p>`;
            if (window.i18n) i18n.updatePageContent();
            return;
        }

        const lang = window.i18n ? i18n.currentLang : 'ja';

        this.container.innerHTML = this.data.fanart.map((item, index) => `
            <div class="gallery-item" data-index="${index}">
                <img
                    data-src="${item.path}"
                    alt="${item.caption[lang] || item.caption.ja}"
                    class="gallery-image lazy"
                    loading="lazy"
                >
                <div class="gallery-overlay">
                    <p class="gallery-artist">
                        ${item.artistLink
                            ? `<a href="${item.artistLink}" target="_blank" rel="noopener">${item.artist}</a>`
                            : item.artist}
                        ${item.isOfficial ? '<span class="official-badge">Official</span>' : ''}
                    </p>
                    <p class="gallery-caption">${item.caption[lang] || item.caption.ja}</p>
                </div>
            </div>
        `).join('');

        // Add click handlers
        this.container.querySelectorAll('.gallery-item').forEach(item => {
            item.addEventListener('click', (e) => {
                if (e.target.tagName !== 'A') {
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
        const lang = window.i18n ? i18n.currentLang : 'ja';

        const imgContainer = this.lightbox.querySelector('.lightbox-image');
        const infoContainer = this.lightbox.querySelector('.lightbox-info');

        if (imgContainer) {
            imgContainer.innerHTML = `<img src="${item.path}" alt="${item.caption[lang] || item.caption.ja}">`;
        }

        if (infoContainer) {
            infoContainer.innerHTML = `
                <p class="lightbox-artist">
                    ${item.artistLink
                        ? `<a href="${item.artistLink}" target="_blank" rel="noopener">${item.artist}</a>`
                        : item.artist}
                    ${item.isOfficial ? '<span class="official-badge">Official</span>' : ''}
                </p>
                <p class="lightbox-caption">${item.caption[lang] || item.caption.ja}</p>
                <p class="lightbox-date">${item.date}</p>
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
        if (this.lightbox.classList.contains('active')) {
            this.updateLightboxContent();
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
