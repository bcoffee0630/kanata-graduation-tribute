/** Footer sharing: an X intent link, the device share sheet, or a copied link as the fallback. */
(function() {
    const xLink = document.getElementById('share-twitter');
    const nativeButton = document.getElementById('share-native');
    if (!xLink && !nativeButton) return;
    const fallbackCopy = {
        post_text: '天音かなた卒業記念 #天音かなた #かなたん',
        share_x: 'Share on X', share_native: 'Share', copy_link: 'Copy link',
        link_copied: 'Link copied.', copy_failed: 'The link could not be copied.'
    };
    const canShare = typeof navigator.share === 'function';

    function t(key) {
        const translated = window.i18n?.t(`footer.${key}`);
        return translated && translated !== `footer.${key}` ? translated : fallbackCopy[key];
    }

    // Share the site itself, never the visitor's section anchor or tracking parameters.
    function canonicalUrl() {
        const declared = document.querySelector('meta[property="og:url"]')?.content;
        try {
            const url = new URL(declared || '/', window.location.href);
            if (url.protocol === 'https:' || url.protocol === 'http:') return `${url.origin}${url.pathname}`;
        } catch {}
        return `${window.location.origin}/`;
    }

    function intentUrl() {
        const url = new URL('https://x.com/intent/post');
        url.searchParams.set('text', t('post_text'));
        url.searchParams.set('url', canonicalUrl());
        return url.href;
    }

    function setLabel(element, label) {
        element?.setAttribute('aria-label', label);
        if (element) element.title = label;
    }

    function updateLabels() {
        if (xLink) {
            xLink.href = intentUrl();
            setLabel(xLink, t('share_x'));
        }
        if (nativeButton) {
            setLabel(nativeButton, t(canShare ? 'share_native' : 'copy_link'));
            nativeButton.querySelector('[data-share-icon="share"]')?.toggleAttribute('hidden', !canShare);
            nativeButton.querySelector('[data-share-icon="link"]')?.toggleAttribute('hidden', canShare);
        }
    }

    function copyWithSelection(text) {
        const field = document.createElement('textarea');
        field.value = text;
        field.setAttribute('readonly', '');
        field.className = 'share-copy-buffer';
        document.body.append(field);
        field.select();
        try { return document.execCommand('copy'); }
        finally { field.remove(); }
    }

    async function copyLink() {
        const url = canonicalUrl();
        let copied = false;
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(url);
                copied = true;
            }
        } catch {}
        if (!copied) {
            try { copied = copyWithSelection(url); } catch {}
        }
        // toast.js declares Toast lexically, so it is not a window property.
        const toast = typeof Toast !== 'undefined' ? Toast : window.Toast;
        if (copied) toast?.success(t('link_copied'));
        else toast?.error(`${t('copy_failed')} ${url}`);
    }

    xLink?.addEventListener('click', event => {
        // Desktop keeps the compact composer window; touch devices follow the link so X can open its app.
        if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
        event.preventDefault();
        window.open(intentUrl(), 'share-on-x', 'noopener,noreferrer,width=600,height=640');
    });

    nativeButton?.addEventListener('click', async () => {
        if (!canShare) { await copyLink(); return; }
        try {
            await navigator.share({ title: document.title, text: t('post_text'), url: canonicalUrl() });
        } catch (error) {
            // Closing the share sheet is a normal choice; other failures still leave the link available.
            if (error?.name !== 'AbortError') await copyLink();
        }
    });

    window.addEventListener('languageChanged', updateLabels);
    updateLabels();
    window.Share = { canonicalUrl, intentUrl };
})();
