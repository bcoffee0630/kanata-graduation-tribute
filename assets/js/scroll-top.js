/**
 * Back to Top Button
 * Shows a floating button when user scrolls down
 */

(function() {
    const backToTopBtn = document.getElementById('back-to-top');
    if (!backToTopBtn) return;

    const scrollThreshold = 300;
    let ticking = false;

    // Check scroll position and toggle button visibility
    function updateButtonVisibility() {
        if (window.scrollY > scrollThreshold) {
            backToTopBtn.classList.add('visible');
        } else {
            backToTopBtn.classList.remove('visible');
        }
        ticking = false;
    }

    // Throttled scroll handler
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(updateButtonVisibility);
            ticking = true;
        }
    }, { passive: true });

    // Smooth scroll to top
    backToTopBtn.addEventListener('click', () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    });

    // Initial check
    updateButtonVisibility();
})();
