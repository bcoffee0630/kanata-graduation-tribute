/** Official YouTube video behind the hero: muted autoplay, with sound and pause controls. */
(function() {
    const VIDEO_ID = 'IdXhY6zGC4s';
    const header = document.querySelector('.main-header');
    const layer = document.querySelector('.header-video');
    const mount = document.getElementById('header-video-player');
    const muteButton = document.getElementById('header-video-mute');
    const playButton = document.getElementById('header-video-play-pause');
    if (!header || !layer || !mount || !muteButton || !playButton) return;

    const fallbackLabels = {
        'zh-TW': { mute: '關閉聲音', unmute: '開啟聲音', pause: '暫停影片', play: '播放影片' },
        ja: { mute: '音声をオフにする', unmute: '音声をオンにする', pause: '動画を一時停止', play: '動画を再生' },
        en: { mute: 'Mute video', unmute: 'Unmute video', pause: 'Pause video', play: 'Play video' }
    };
    const buttons = [muteButton, playButton];
    const reducedMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let player = null;
    let ready = false;
    let failed = false;
    let muted = true;
    // The viewer's intent; reduced motion waits for an explicit play.
    let paused = reducedMotion;
    let playing = false;
    let visible = true;

    function label(name) {
        const key = `header_video.${name}`;
        const translated = window.i18n?.t?.(key);
        return typeof translated === 'string' && translated !== key && translated.trim()
            ? translated : (fallbackLabels[window.i18n?.currentLang] || fallbackLabels.en)[name];
    }

    function setControl(button, name, icons) {
        Object.entries(icons).forEach(([icon, shown]) => {
            button.querySelector(`[data-video-icon="${icon}"]`)?.toggleAttribute('hidden', !shown);
        });
        const text = label(name);
        button.setAttribute('aria-label', text);
        const tooltip = document.getElementById(button.getAttribute('aria-describedby'));
        if (tooltip) tooltip.textContent = text;
    }

    function render() {
        setControl(muteButton, muted ? 'unmute' : 'mute', { muted, sound: !muted });
        setControl(playButton, playing ? 'pause' : 'play', { pause: playing, play: !playing });
    }

    // A muted video off screen is pure decoration, so it rests; one with sound keeps playing while reading.
    function sync() {
        if (!ready || failed) return;
        if (!paused && (visible || !muted)) player.playVideo();
        else player.pauseVideo();
    }

    function fail() {
        if (failed) return;
        failed = true;
        ready = false;
        try { player?.destroy?.(); } catch { /* The poster image remains either way. */ }
        layer.classList.remove('is-playing');
        layer.hidden = true;
        buttons.forEach(button => { button.hidden = true; });
    }

    function onReady() {
        if (failed) return;
        ready = true;
        const iframe = player.getIframe?.();
        if (iframe) {
            iframe.setAttribute('tabindex', '-1');
            iframe.setAttribute('title', '誰も見てない夢を見ろ / 天音かなた(official)');
        }
        player.mute();
        buttons.forEach(button => { button.hidden = false; });
        render();
        sync();
    }

    function onStateChange(event) {
        const { PLAYING, BUFFERING, ENDED } = window.YT.PlayerState;
        if (event.data === PLAYING) layer.classList.add('is-playing');
        if (event.data === ENDED && !paused) {
            player.seekTo(0, true);
            player.playVideo();
        }
        playing = event.data === PLAYING || event.data === BUFFERING;
        render();
    }

    function loadApi() {
        if (window.YT?.Player) return Promise.resolve(window.YT);
        return new Promise((resolve, reject) => {
            const previous = window.onYouTubeIframeAPIReady;
            window.onYouTubeIframeAPIReady = () => {
                if (typeof previous === 'function') previous();
                resolve(window.YT);
            };
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            script.async = true;
            script.onerror = () => reject(new Error('YouTube player could not load'));
            document.head.appendChild(script);
        });
    }

    muteButton.addEventListener('click', () => {
        if (!ready) return;
        muted = !muted;
        if (muted) player.mute();
        else player.unMute();
        render();
        sync();
    });
    playButton.addEventListener('click', () => {
        if (!ready) return;
        paused = playing;
        sync();
    });

    buttons.forEach(button => {
        const reset = () => button.classList.remove('tooltip-dismissed');
        button.addEventListener('pointerenter', reset);
        button.addEventListener('focus', reset);
    });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') buttons.forEach(button => button.classList.add('tooltip-dismissed'));
    });
    window.addEventListener('languageChanged', render);

    if (typeof IntersectionObserver !== 'undefined') {
        new IntersectionObserver(entries => {
            visible = entries[entries.length - 1].isIntersecting;
            sync();
        }).observe(header);
    }

    render();
    loadApi().then(YT => {
        if (failed) return;
        player = new YT.Player(mount, {
            host: 'https://www.youtube-nocookie.com',
            videoId: VIDEO_ID,
            width: '100%',
            height: '100%',
            playerVars: {
                autoplay: reducedMotion ? 0 : 1,
                mute: 1,
                loop: 1,
                playlist: VIDEO_ID,
                controls: 0,
                disablekb: 1,
                fs: 0,
                iv_load_policy: 3,
                playsinline: 1,
                rel: 0,
                ...(window.location.protocol.startsWith('http') ? { origin: window.location.origin } : {})
            },
            events: { onReady, onStateChange, onError: fail }
        });
    }).catch(fail);
})();
