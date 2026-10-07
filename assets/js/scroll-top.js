/** Contextual reading actions and accessible back-to-top navigation. */
(function() {
    const top = document.getElementById('back-to-top');
    if (!top) return;
    const gallery = document.getElementById('gallery-refresh');
    const messages = document.getElementById('danmaku-play-pause');
    const nav = document.querySelector('.site-nav');
    const sections = [
        { element: document.getElementById('danmaku-section'), button: messages },
        { element: document.getElementById('gallery-section'), button: gallery }
    ].filter(section => section.element && section.button);
    const buttons = [gallery, messages, top].filter(Boolean);
    const dismissTooltip = new Map();
    let activeSection;
    let frame = null;

    function setVisible(button, visible) {
        if (!button) return;
        button.hidden = !visible;
        if (visible) return;
        dismissTooltip.get(button)?.();
        button.classList.remove('tooltip-dismissed');
        if (document.activeElement === button) button.blur();
    }

    function updateVisibility() {
        frame = null;
        const height = window.innerHeight;
        const navBottom = Math.max(0, Math.min(height, nav?.getBoundingClientRect().bottom || 0));
        const midpoint = (navBottom + height) / 2;
        const bounds = sections.map(section => ({ section, rect: section.element.getBoundingClientRect() }));
        const contains = ({ rect }, buffer = 0) => rect.bottom > navBottom && rect.top < height &&
            midpoint >= rect.top - buffer && midpoint < rect.bottom + buffer;
        // Keep the current action through small movements around a section boundary.
        const current = bounds.find(entry => entry.section === activeSection);
        if (!current || !contains(current, 24)) {
            activeSection = bounds.find(entry => contains(entry))?.section;
        }
        const modalOpen = !!document.querySelector('.modal.active');
        setVisible(gallery, !modalOpen && activeSection?.button === gallery);
        setVisible(messages, !modalOpen && activeSection?.button === messages);
        setVisible(top, !modalOpen && window.scrollY > 300);
    }
    function scheduleVisibility() {
        if (frame === null) frame = requestAnimationFrame(updateVisibility);
    }
    window.addEventListener('scroll', scheduleVisibility, { passive: true });
    window.addEventListener('resize', scheduleVisibility);
    document.querySelectorAll('.modal').forEach(modal => {
        new MutationObserver(scheduleVisibility).observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
    if (nav) {
        new MutationObserver(scheduleVisibility).observe(nav, { attributes: true, attributeFilter: ['class'] });
        nav.addEventListener('transitionend', scheduleVisibility);
    }
    if (typeof ResizeObserver !== 'undefined') {
        const observer = new ResizeObserver(scheduleVisibility);
        sections.forEach(section => observer.observe(section.element));
        if (nav) observer.observe(nav);
    }
    sections.forEach(section => section.element.addEventListener('transitionend', scheduleVisibility));
    top.addEventListener('click', () => window.scrollTo({ top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    buttons.forEach(button => {
        let timeout;
        let touch = false;
        dismissTooltip.set(button, () => {
            clearTimeout(timeout);
            touch = false;
            button.classList.remove('tooltip-visible');
        });
        button.addEventListener('pointerdown', event => {
            touch = event.pointerType === 'touch';
            button.classList.remove('tooltip-dismissed');
        });
        button.addEventListener('focus', () => button.classList.remove('tooltip-dismissed'));
        button.addEventListener('pointerenter', () => button.classList.remove('tooltip-dismissed'));
        button.addEventListener('pointerleave', () => button.classList.remove('tooltip-dismissed'));
        button.addEventListener('click', event => {
            if (button.hidden || (!touch && event.pointerType !== 'touch')) return;
            touch = false;
            clearTimeout(timeout);
            button.classList.add('tooltip-visible');
            timeout = setTimeout(() => button.classList.remove('tooltip-visible'), 1800);
        });
        button.addEventListener('blur', dismissTooltip.get(button));
    });
    window.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        buttons.forEach(button => {
            dismissTooltip.get(button)();
            button.classList.add('tooltip-dismissed');
        });
    });
    function updateLanguage() {
        const translated = window.i18n?.t('gallery.back_to_top');
        const label = translated && translated !== 'gallery.back_to_top' ? translated : 'Back to top';
        top.setAttribute('aria-label', label);
        document.getElementById('back-to-top-tooltip').textContent = label;
        scheduleVisibility();
    }
    window.addEventListener('languageChanged', updateLanguage);
    updateVisibility();
    updateLanguage();
})();
