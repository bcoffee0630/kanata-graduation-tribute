/**
 * Feather Effects - Mouse trail only
 * White feathers for Kanata's angel (天使/Tenshi) theme
 */

class FeatherTrail {
    constructor() {
        this.container = null;
        this.maxFeathers = 15;
        this.feathers = [];
        this.lastTime = 0;
        this.throttleMs = 60; // Throttle mouse events
        this.isDesktop = false;

        this.init();
    }

    init() {
        // Create container
        this.container = document.createElement('div');
        this.container.className = 'feather-container';
        document.body.appendChild(this.container);

        // Check if desktop (has fine pointer like mouse)
        this.isDesktop = window.matchMedia('(pointer: fine)').matches;

        // Enable mouse trail only on desktop
        if (this.isDesktop) {
            document.addEventListener('mousemove', (e) => this.onMouseMove(e), { passive: true });
        }
    }

    onMouseMove(e) {
        const now = Date.now();
        if (now - this.lastTime < this.throttleMs) return;
        this.lastTime = now;

        // Random chance to spawn feather (not every movement)
        if (Math.random() > 0.35) return;

        this.createFeather(e.clientX, e.clientY);
    }

    createFeather(x, y) {
        // Limit total feathers
        if (this.feathers.length >= this.maxFeathers) {
            const oldest = this.feathers.shift();
            if (oldest && oldest.parentNode) {
                oldest.remove();
            }
        }

        const feather = document.createElement('div');
        feather.className = 'feather trail';

        // Position with slight random offset
        const offsetX = (Math.random() - 0.5) * 20;
        const offsetY = (Math.random() - 0.5) * 20;
        feather.style.left = (x + offsetX) + 'px';
        feather.style.top = (y + offsetY) + 'px';

        // Random initial rotation for variety
        const randomRotate = Math.random() * 60 - 30;
        feather.style.transform = `rotate(${randomRotate}deg)`;

        this.container.appendChild(feather);
        this.feathers.push(feather);

        // Remove after animation ends
        const removeFeather = () => {
            if (feather.parentNode) {
                feather.remove();
            }
            this.feathers = this.feathers.filter(f => f !== feather);
        };

        feather.addEventListener('animationend', removeFeather, { once: true });

        // Fallback removal (in case animationend doesn't fire)
        setTimeout(removeFeather, 1800);
    }

    // Cleanup method
    destroy() {
        if (this.container && this.container.parentNode) {
            this.container.remove();
        }
        this.feathers = [];
    }
}

// Initialize only if reduced motion is not preferred
if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.addEventListener('DOMContentLoaded', () => {
        window.featherTrail = new FeatherTrail();
    });
}
