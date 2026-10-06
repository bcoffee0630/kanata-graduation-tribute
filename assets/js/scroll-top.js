/** Accessible back-to-top navigation. */
(function() {
    const top = document.getElementById('back-to-top');
    if (!top) return;
    const buttons = [top];
    let frame;
    function updateVisibility() {
        frame = null;
        const modalOpen = !!document.querySelector('.modal.active');
        top.hidden = modalOpen || window.scrollY <= 300;
        if (modalOpen) buttons.forEach(button => button.classList.remove('tooltip-visible'));
    }
    function scheduleVisibility() {
        if (!frame) frame = requestAnimationFrame(updateVisibility);
    }
    window.addEventListener('scroll', scheduleVisibility, { passive: true });
    window.addEventListener('resize', scheduleVisibility);
    document.querySelectorAll('.modal').forEach(modal => {
        new MutationObserver(scheduleVisibility).observe(modal, { attributes: true, attributeFilter: ['class'] });
    });
    top.addEventListener('click', () => window.scrollTo({ top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }));
    buttons.forEach(button => {
        let timeout;
        let touch = false;
        button.addEventListener('pointerdown', event => {
            touch = event.pointerType === 'touch';
            button.classList.remove('tooltip-dismissed');
        });
        button.addEventListener('focus', () => button.classList.remove('tooltip-dismissed'));
        button.addEventListener('pointerleave', () => button.classList.remove('tooltip-dismissed'));
        button.addEventListener('click', event => {
            if (!touch && event.pointerType !== 'touch') return;
            touch = false;
            clearTimeout(timeout);
            button.classList.add('tooltip-visible');
            timeout = setTimeout(() => button.classList.remove('tooltip-visible'), 1800);
        });
        button.addEventListener('blur', () => button.classList.remove('tooltip-visible'));
    });
    window.addEventListener('keydown', event => {
        if (event.key !== 'Escape') return;
        buttons.forEach(button => {
            button.classList.remove('tooltip-visible');
            button.classList.add('tooltip-dismissed');
        });
    });
    function updateLanguage() {
        const translated = window.i18n?.t('gallery.back_to_top');
        const label = translated && translated !== 'gallery.back_to_top' ? translated : 'Back to top';
        top.setAttribute('aria-label', label);
        document.getElementById('back-to-top-tooltip').textContent = label;
    }
    window.addEventListener('languageChanged', updateLanguage);
    updateLanguage();
    updateVisibility();
})();
