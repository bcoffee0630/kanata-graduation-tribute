/**
 * Scroll Reveal Animations
 * Elements with .reveal-on-scroll class will animate when entering viewport
 */

class ScrollReveal {
    constructor() {
        this.observer = null;
        this.init();
    }

    init() {
        // Check for reduced motion preference
        if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            // Show all elements immediately
            document.querySelectorAll('.reveal-on-scroll').forEach(el => {
                el.classList.add('revealed');
            });
            return;
        }

        // Set up Intersection Observer
        const options = {
            threshold: 0.1,
            rootMargin: '0px 0px -50px 0px'
        };

        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    // Add staggered delay for multiple elements
                    const delay = entry.target.dataset.revealDelay || 0;

                    setTimeout(() => {
                        entry.target.classList.add('revealed');
                    }, delay);

                    // Stop observing once revealed
                    this.observer.unobserve(entry.target);
                }
            });
        }, options);

        // Observe all reveal elements
        document.querySelectorAll('.reveal-on-scroll').forEach((el, index) => {
            // Add stagger delay if part of a group
            if (el.closest('.reveal-group')) {
                el.dataset.revealDelay = index * 100;
            }
            this.observer.observe(el);
        });
    }

    // Method to observe new elements (for dynamic content)
    observe(element) {
        if (this.observer && element) {
            this.observer.observe(element);
        }
    }

    // Cleanup
    destroy() {
        if (this.observer) {
            this.observer.disconnect();
        }
    }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
    window.scrollReveal = new ScrollReveal();
});
