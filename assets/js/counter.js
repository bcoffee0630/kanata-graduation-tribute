// Graduation date: December 27, 2025, Japan Time
const graduationDate = new Date('2025-12-27T00:00:00+09:00');

function updateDayCounter() {
    const now = new Date();
    const diffTime = Math.abs(now - graduationDate);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    // Update the day number
    const numberElement = document.getElementById('day-counter-number');
    if (numberElement) {
        numberElement.textContent = diffDays;
    }

    // Update page title with day count
    if (typeof i18n !== 'undefined' && i18n.translations && i18n.translations.site_title) {
        document.title = `${i18n.t('site_title')} - Day ${diffDays}`;
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
