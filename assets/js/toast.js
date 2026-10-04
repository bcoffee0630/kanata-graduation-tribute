/**
 * Toast Notification System
 * A lightweight, accessible toast notification system
 */

const Toast = (function() {
    let container = null;
    let reducedMotion = null;
    const states = new WeakMap();
    const countdowns = new Set();

    function closeLabel() {
        const translated = window.i18n?.t('modal.close');
        if (translated && translated !== 'modal.close') return translated;
        const lang = document.documentElement.lang;
        return lang.startsWith('zh') ? '關閉' : lang.startsWith('ja') ? '閉じる' : 'Close';
    }

    // SVG Icons
    const icons = {
        success: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
            <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>`,
        error: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>`,
        info: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="16" x2="12" y2="12"/>
            <line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>`,
        warning: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>`
    };

    /**
     * Initialize the toast container
     */
    function init() {
        if (container) return;

        container = document.createElement('div');
        container.className = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
        window.addEventListener('languageChanged', () => {
            container.querySelectorAll('.toast-close').forEach(button => button.setAttribute('aria-label', closeLabel()));
        });
        reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const refreshCountdowns = () => {
            countdowns.forEach(toast => {
                const state = states.get(toast);
                if (!state) return;
                cancelFrame(state, 'frameId');
                updateCountdown(toast, state);
            });
        };
        document.addEventListener('visibilitychange', refreshCountdowns);
        reducedMotion.addEventListener('change', refreshCountdowns);
    }

    function cancelFrame(state, key) {
        if (state[key] === null) return;
        cancelAnimationFrame(state[key]);
        state[key] = null;
    }

    function stopCountdown(toast) {
        const state = states.get(toast);
        if (state) {
            clearTimeout(state.timerId);
            cancelFrame(state, 'entranceFrameId');
            cancelFrame(state, 'frameId');
            cancelFrame(state, 'expiryFrameId');
            states.delete(toast);
        }
        countdowns.delete(toast);
    }

    function finishCountdown(toast, state) {
        cancelFrame(state, 'frameId');
        clearTimeout(state.timerId);
        state.timerId = null;
        if (document.hidden || reducedMotion.matches) {
            dismiss(toast);
            return;
        }
        state.button.style.setProperty('--toast-close-progress', '100%');
        if (state.expiryFrameId !== null) return;
        // Paint the filled button once before starting the existing fade-out.
        state.expiryFrameId = requestAnimationFrame(() => {
            state.expiryFrameId = requestAnimationFrame(() => {
                state.expiryFrameId = null;
                dismiss(toast);
            });
        });
    }

    function updateCountdown(toast, state) {
        if (!toast.isConnected || toast.classList.contains('hide')) {
            stopCountdown(toast);
            return 0;
        }
        const remaining = state.deadline - performance.now();
        if (remaining <= 0) {
            finishCountdown(toast, state);
            return 0;
        }
        const progress = reducedMotion.matches ? 0 : Math.max(0, (1 - remaining / state.duration) * 100);
        state.button.style.setProperty('--toast-close-progress', `${progress}%`);
        if (!document.hidden && !reducedMotion.matches && state.frameId === null) {
            state.frameId = requestAnimationFrame(() => {
                state.frameId = null;
                updateCountdown(toast, state);
            });
        }
        return remaining;
    }

    function scheduleDeadline(toast, state, remaining) {
        state.timerId = setTimeout(() => {
            state.timerId = null;
            const nextRemaining = updateCountdown(toast, state);
            if (nextRemaining > 0) scheduleDeadline(toast, state, nextRemaining);
        }, remaining);
    }

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {string} type - Toast type: 'success', 'error', 'info', 'warning'
     * @param {number} duration - Duration in ms (default: 3000, 0 for no auto-dismiss)
     * @returns {HTMLElement} The toast element
     */
    function show(message, type = 'info', duration = 3000) {
        init();

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <span class="toast-icon" aria-hidden="true">${icons[type] || icons.info}</span>
            <span class="toast-content">${escapeHtml(message)}</span>
            <button class="toast-close" type="button">
                <span class="toast-close-glyph" aria-hidden="true">&times;</span>
                <span class="toast-close-fill" aria-hidden="true">&times;</span>
            </button>
        `;

        // Close button handler
        const closeBtn = toast.querySelector('.toast-close');
        closeBtn.setAttribute('aria-label', closeLabel());
        closeBtn.addEventListener('click', () => dismiss(toast));

        // Add to container
        container.appendChild(toast);

        const state = {
            button: closeBtn,
            duration,
            deadline: performance.now() + duration,
            timerId: null,
            entranceFrameId: null,
            frameId: null,
            expiryFrameId: null
        };
        states.set(toast, state);

        // Trigger animation
        state.entranceFrameId = requestAnimationFrame(() => {
            state.entranceFrameId = null;
            if (!toast.classList.contains('hide')) toast.classList.add('show');
        });

        if (duration > 0) {
            countdowns.add(toast);
            updateCountdown(toast, state);
            scheduleDeadline(toast, state, duration);
        }

        return toast;
    }

    /**
     * Dismiss a toast
     * @param {HTMLElement} toast - The toast element to dismiss
     */
    function dismiss(toast) {
        if (!toast) return;
        stopCountdown(toast);
        if (!toast.parentNode || toast.classList.contains('hide')) return;

        toast.classList.remove('show');
        toast.classList.add('hide');

        setTimeout(() => {
            if (toast.parentNode) {
                toast.parentNode.removeChild(toast);
            }
        }, 400);
    }

    /**
     * Clear all toasts
     */
    function clearAll() {
        if (!container) return;
        const toasts = container.querySelectorAll('.toast');
        toasts.forEach(toast => dismiss(toast));
    }

    /**
     * Escape HTML to prevent XSS
     */
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // Convenience methods
    return {
        show,
        dismiss,
        clearAll,
        success: (message, duration) => show(message, 'success', duration),
        error: (message, duration) => show(message, 'error', duration),
        info: (message, duration) => show(message, 'info', duration),
        warning: (message, duration) => show(message, 'warning', duration)
    };
})();

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
    module.exports = Toast;
}
