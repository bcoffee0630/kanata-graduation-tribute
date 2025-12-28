// Graduation date: December 27, 2025, Japan Time
const graduationDate = new Date('2025-12-27T00:00:00+09:00');

function updateDayCounter() {
    const now = new Date();
    const diffTime = Math.abs(now - graduationDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));
    
    // Wait for i18n to be ready
    if (typeof i18n !== 'undefined' && i18n.translations && i18n.translations.day_counter) {
        const counterText = i18n.t('day_counter', { days: diffDays });
        const counterElement = document.getElementById('day-counter-text');
        if (counterElement) {
            counterElement.textContent = counterText;
        }
        
        // Update page title with day count
        document.title = `${i18n.t('site_title')} - Day ${diffDays}`;
    } else {
        // Fallback display
        const counterElement = document.getElementById('day-counter-text');
        if (counterElement) {
            counterElement.textContent = `卒業から${diffDays}日目`;
        }
    }
}

// Listen for language change events
window.addEventListener('languageChanged', updateDayCounter);

// Update immediately and every minute
document.addEventListener('DOMContentLoaded', () => {
    updateDayCounter();
    setInterval(updateDayCounter, 60000);
});

// Initial update
updateDayCounter();