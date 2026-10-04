/** Official X embeds shared by the gallery and the optional submission preview. */
(() => {
    const hosts = new Set(['x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com']);
    let widgetPromise = null;

    function parseUrl(value) {
        try {
            if (typeof value !== 'string') return null;
            const normalized = value.trim();
            if (normalized.length > 500 || !normalized.startsWith('https://') || /[\\\x00-\x20]/.test(normalized)) return null;
            const url = new URL(normalized);
            if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.username || url.password || url.port) return null;
            const match = url.pathname.match(/^\/(?:([A-Za-z0-9_]{1,15})\/status|i\/(?:web\/)?status)\/([1-9]\d{0,24})(?:\/(?:photo|video)\/[1-4])?\/?$/);
            if (!match) return null;
            const postId = match[2];
            return { postId, postUrl: `https://x.com/${match[1] && match[1] !== 'i' ? `${match[1]}/status` : 'i/web/status'}/${postId}` };
        } catch {
            return null;
        }
    }

    function text(key) {
        const translated = window.i18n?.t(`gallery.${key}`);
        return translated && translated !== `gallery.${key}` ? translated : {
            embed_loading: 'Loading X post…', embed_error: 'This X post could not be displayed.',
            open_original: 'Open original post', retry: 'Try again'
        }[key];
    }

    function loadWidgets() {
        if (window.twttr?.widgets?.createTweet) return Promise.resolve(window.twttr);
        if (widgetPromise) return widgetPromise;
        const pending = new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.id = 'x-widgets-script';
            script.src = 'https://platform.x.com/widgets.js';
            script.async = true;
            let settled = false;
            const finish = (error) => {
                if (settled) return;
                settled = true;
                clearTimeout(timeout);
                script.onload = script.onerror = null;
                if (error) { script.remove(); reject(error); }
                else resolve(window.twttr);
            };
            const timeout = setTimeout(() => finish(new Error('X widgets timed out')), 12000);
            script.onerror = () => finish(new Error('X widgets could not load'));
            script.onload = () => {
                if (window.twttr?.widgets?.createTweet) finish();
                else if (window.twttr?.ready) window.twttr.ready(() => {
                    finish(window.twttr?.widgets?.createTweet ? null : new Error('X widgets unavailable'));
                });
                else finish(new Error('X widgets unavailable'));
            };
            document.head.appendChild(script);
        });
        widgetPromise = pending;
        pending.catch(() => { if (widgetPromise === pending) widgetPromise = null; });
        return pending;
    }

    function mount(container, postUrl, { lazy = false } = {}) {
        const post = parseUrl(postUrl);
        if (!post) return { destroy() {} };
        let generation = 0;
        let destroyed = false;
        let observer = null;
        let timer = null;
        let cancelTimeout = null;

        const status = document.createElement('p');
        status.className = 'x-embed-message';
        status.setAttribute('role', 'status');
        const fallback = document.createElement('div');
        fallback.className = 'x-embed-fallback';
        const link = document.createElement('a');
        link.href = post.postUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = text('open_original');
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'x-embed-retry';
        retry.textContent = text('retry');
        fallback.append(link, retry);
        let frame = document.createElement('div');
        frame.className = 'x-embed-frame';
        container.replaceChildren(frame, status, fallback);

        function setLoading() {
            container.dataset.embedState = 'loading';
            container.setAttribute('aria-busy', 'true');
            status.textContent = text('embed_loading');
            status.hidden = false;
            fallback.hidden = true;
        }

        async function render() {
            if (destroyed) return;
            const run = ++generation;
            cancelTimeout?.();
            setLoading();
            const nextFrame = document.createElement('div');
            nextFrame.className = 'x-embed-frame';
            frame.replaceWith(nextFrame);
            frame = nextFrame;
            try {
                const widgets = await loadWidgets();
                if (destroyed || run !== generation) return;
                const timeout = new Promise((_, reject) => {
                    cancelTimeout = () => { clearTimeout(timer); reject(new Error('X embed cancelled')); };
                    timer = setTimeout(() => reject(new Error('X embed timed out')), 15000);
                });
                const result = await Promise.race([
                    widgets.widgets.createTweet(post.postId, nextFrame, {
                        theme: 'light', conversation: 'none', dnt: true,
                        lang: window.i18n?.currentLang === 'zh-TW' ? 'zh-tw' : window.i18n?.currentLang || 'ja',
                        align: 'center'
                    }), timeout
                ]);
                if (destroyed || run !== generation) return;
                if (!result) throw new Error('X post unavailable');
                status.hidden = true;
                fallback.hidden = true;
                container.dataset.embedState = 'ready';
            } catch {
                if (destroyed || run !== generation) return;
                // A late third-party response can only modify this detached frame.
                nextFrame.replaceWith(frame = document.createElement('div'));
                frame.className = 'x-embed-frame';
                status.textContent = text('embed_error');
                status.hidden = false;
                fallback.hidden = false;
                container.dataset.embedState = 'error';
            } finally {
                if (run === generation) {
                    clearTimeout(timer);
                    cancelTimeout = null;
                    container.setAttribute('aria-busy', 'false');
                }
            }
        }
        retry.addEventListener('click', render);
        setLoading();
        if (lazy && 'IntersectionObserver' in window) {
            observer = new IntersectionObserver((entries) => {
                if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); render(); }
            }, { rootMargin: '300px' });
            observer.observe(container);
        } else render();
        return { destroy() { destroyed = true; generation++; observer?.disconnect(); cancelTimeout?.(); clearTimeout(timer); } };
    }

    window.XPost = { parseUrl, mount };
})();
