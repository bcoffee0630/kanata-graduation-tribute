import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('assets/js/header-video.js', 'utf8');
const PlayerState = { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 };

// The YouTube player is replaced by a recorder; state changes are delivered by each scenario.
function runtime({ reducedMotion = false, apiLoaded = true, translations = {}, lang = 'ja', apiHook } = {}) {
  const listeners = () => {
    const events = new Map();
    return {
      addEventListener(type, callback) {
        if (!events.has(type)) events.set(type, []);
        events.get(type).push(callback);
      },
      dispatch(type, detail = {}) {
        events.get(type)?.forEach(callback => callback({ type, ...detail }));
      },
    };
  };
  const element = (id, children = {}) => {
    const classes = new Set();
    const attributes = new Map();
    const node = {
      ...listeners(), id, hidden: false, textContent: '',
      classList: {
        add: value => classes.add(value),
        remove: value => classes.delete(value),
        contains: value => classes.has(value),
      },
      setAttribute: (name, value) => attributes.set(name, String(value)),
      getAttribute: name => attributes.get(name) ?? null,
      querySelector: selector => children[selector] || null,
      toggleAttribute(name, force) { if (name === 'hidden') this.hidden = force; },
    };
    return node;
  };
  const icon = name => element(`icon-${name}`);
  const icons = { muted: icon('muted'), sound: icon('sound'), pause: icon('pause'), play: icon('play') };
  const mute = element('header-video-mute', {
    '[data-video-icon="muted"]': icons.muted, '[data-video-icon="sound"]': icons.sound,
  });
  const play = element('header-video-play-pause', {
    '[data-video-icon="pause"]': icons.pause, '[data-video-icon="play"]': icons.play,
  });
  mute.hidden = play.hidden = true;
  mute.setAttribute('aria-describedby', 'header-video-mute-tooltip');
  play.setAttribute('aria-describedby', 'header-video-play-pause-tooltip');
  const nodes = Object.fromEntries([
    ['header-video-mute', mute], ['header-video-play-pause', play],
    ['header-video-mute-tooltip', element('header-video-mute-tooltip')],
    ['header-video-play-pause-tooltip', element('header-video-play-pause-tooltip')],
    ['header-video-player', element('header-video-player')],
  ]);
  const header = element('main-header');
  const layer = element('header-video');
  const scripts = [];
  const document = {
    getElementById: id => nodes[id] || null,
    querySelector: selector => ({ '.main-header': header, '.header-video': layer })[selector] || null,
    createElement: () => ({}),
    head: { appendChild: script => scripts.push(script) },
  };
  const iframe = element('iframe');
  let player = null;
  class Player {
    constructor(target, options) {
      this.target = target;
      this.options = options;
      this.mute = vi.fn();
      this.unMute = vi.fn();
      this.playVideo = vi.fn();
      this.pauseVideo = vi.fn();
      this.seekTo = vi.fn();
      this.destroy = vi.fn();
      this.getIframe = () => iframe;
      player = this;
    }
  }
  const observers = [];
  class IntersectionObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
  }
  const YT = { Player, PlayerState };
  const window = {
    ...listeners(),
    location: { protocol: 'https:', origin: 'https://eienkanata.com' },
    matchMedia: vi.fn(() => ({ matches: reducedMotion })),
    i18n: { currentLang: lang, t: key => translations[key] ?? key },
    ...(apiLoaded ? { YT } : {}),
    ...(apiHook ? { onYouTubeIframeAPIReady: apiHook } : {}),
  };
  runInNewContext(source, { document, window, IntersectionObserver, Promise });
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const app = {
    window, scripts, header, layer, mute, play, icons, nodes, iframe, YT,
    get player() { return player; },
    settle,
    ready: () => player.options.events.onReady({ target: player }),
    state: data => player.options.events.onStateChange({ data }),
    error: code => player.options.events.onError({ data: code }),
    intersect: isIntersecting => observers.forEach(observer => observer.callback([{ isIntersecting }])),
  };
  return app;
}

async function readyApp(options) {
  const app = runtime(options);
  await app.settle();
  app.ready();
  return app;
}

describe('hero background video', () => {
  it('embeds the official video muted, looping and privacy-enhanced without YouTube chrome', async () => {
    const app = runtime();
    await app.settle();
    const { host, videoId, playerVars } = app.player.options;
    expect(host).toBe('https://www.youtube-nocookie.com');
    expect(videoId).toBe('IdXhY6zGC4s');
    expect(playerVars).toMatchObject({
      autoplay: 1, mute: 1, loop: 1, playlist: 'IdXhY6zGC4s', controls: 0, playsinline: 1,
      rel: 0, fs: 0, disablekb: 1, iv_load_policy: 3, origin: 'https://eienkanata.com',
    });
    expect(app.mute.hidden).toBe(true);
    expect(app.play.hidden).toBe(true);
  });

  it('loads the IFrame API once and keeps any earlier ready callback', async () => {
    const earlier = vi.fn();
    const app = runtime({ apiLoaded: false, apiHook: earlier });
    expect(app.scripts).toHaveLength(1);
    expect(app.scripts[0].src).toBe('https://www.youtube.com/iframe_api');
    app.window.YT = app.YT;
    app.window.onYouTubeIframeAPIReady();
    await app.settle();
    expect(earlier).toHaveBeenCalledOnce();
    expect(app.player.options.videoId).toBe('IdXhY6zGC4s');
  });

  it('shows the controls once ready and fades the video in only when it actually plays', async () => {
    const app = await readyApp();
    expect(app.player.mute).toHaveBeenCalled();
    expect(app.player.playVideo).toHaveBeenCalled();
    expect(app.mute.hidden).toBe(false);
    expect(app.play.hidden).toBe(false);
    expect(app.iframe.getAttribute('tabindex')).toBe('-1');
    expect(app.layer.classList.contains('is-playing')).toBe(false);
    app.state(PlayerState.BUFFERING);
    expect(app.layer.classList.contains('is-playing')).toBe(false);
    app.state(PlayerState.PLAYING);
    expect(app.layer.classList.contains('is-playing')).toBe(true);
    app.state(PlayerState.PAUSED);
    expect(app.layer.classList.contains('is-playing')).toBe(true);
  });

  it('toggles sound with matching icons, label and tooltip', async () => {
    const app = await readyApp();
    expect(app.mute.getAttribute('aria-label')).toBe('音声をオンにする');
    expect(app.icons.muted.hidden).toBe(false);
    expect(app.icons.sound.hidden).toBe(true);
    app.mute.dispatch('click');
    expect(app.player.unMute).toHaveBeenCalledOnce();
    expect(app.mute.getAttribute('aria-label')).toBe('音声をオフにする');
    expect(app.nodes['header-video-mute-tooltip'].textContent).toBe('音声をオフにする');
    expect(app.icons.muted.hidden).toBe(true);
    expect(app.icons.sound.hidden).toBe(false);
    app.mute.dispatch('click');
    expect(app.player.mute).toHaveBeenCalledTimes(2);
    expect(app.mute.getAttribute('aria-label')).toBe('音声をオンにする');
  });

  it('pauses and resumes from the player state rather than assuming autoplay succeeded', async () => {
    const app = await readyApp();
    // Autoplay can be refused (for example in low power mode); the control must offer play.
    app.state(PlayerState.UNSTARTED);
    expect(app.play.getAttribute('aria-label')).toBe('動画を再生');
    expect(app.icons.play.hidden).toBe(false);
    app.player.playVideo.mockClear();
    app.play.dispatch('click');
    expect(app.player.playVideo).toHaveBeenCalledOnce();
    app.state(PlayerState.PLAYING);
    expect(app.play.getAttribute('aria-label')).toBe('動画を一時停止');
    expect(app.icons.pause.hidden).toBe(false);
    app.play.dispatch('click');
    expect(app.player.pauseVideo).toHaveBeenCalledOnce();
  });

  it('rests a muted video off screen but keeps one with sound playing', async () => {
    const app = await readyApp();
    app.state(PlayerState.PLAYING);
    app.player.playVideo.mockClear();
    app.intersect(false);
    expect(app.player.pauseVideo).toHaveBeenCalledOnce();
    app.intersect(true);
    expect(app.player.playVideo).toHaveBeenCalledOnce();

    app.mute.dispatch('click');
    app.player.pauseVideo.mockClear();
    app.intersect(false);
    expect(app.player.pauseVideo).not.toHaveBeenCalled();
  });

  it('does not resume a video the viewer paused when the hero returns', async () => {
    const app = await readyApp();
    app.state(PlayerState.PLAYING);
    app.play.dispatch('click');
    app.state(PlayerState.PAUSED);
    app.player.playVideo.mockClear();
    app.intersect(false);
    app.intersect(true);
    expect(app.player.playVideo).not.toHaveBeenCalled();
  });

  it('waits for an explicit play when reduced motion is preferred', async () => {
    const app = await readyApp({ reducedMotion: true });
    expect(app.player.options.playerVars.autoplay).toBe(0);
    expect(app.player.playVideo).not.toHaveBeenCalled();
    expect(app.play.hidden).toBe(false);
    expect(app.play.getAttribute('aria-label')).toBe('動画を再生');
    app.play.dispatch('click');
    expect(app.player.playVideo).toHaveBeenCalledOnce();
  });

  it('keeps the poster image and hides the controls when the video cannot be embedded', async () => {
    const app = await readyApp();
    app.state(PlayerState.PLAYING);
    app.error(150);
    expect(app.player.destroy).toHaveBeenCalledOnce();
    expect(app.layer.hidden).toBe(true);
    expect(app.layer.classList.contains('is-playing')).toBe(false);
    expect(app.mute.hidden).toBe(true);
    expect(app.play.hidden).toBe(true);
    app.player.playVideo.mockClear();
    app.intersect(true);
    expect(app.player.playVideo).not.toHaveBeenCalled();
  });

  it('keeps the poster image when the IFrame API script is blocked', async () => {
    const app = runtime({ apiLoaded: false });
    app.scripts[0].onerror();
    await app.settle();
    expect(app.player).toBeNull();
    expect(app.layer.hidden).toBe(true);
    expect(app.mute.hidden).toBe(true);
  });

  it('follows language changes and falls back to built-in labels', async () => {
    const app = await readyApp({ lang: 'en' });
    expect(app.mute.getAttribute('aria-label')).toBe('Unmute video');
    app.window.i18n = { currentLang: 'zh-TW', t: key => ({ 'header_video.unmute': '開啟聲音' })[key] ?? key };
    app.window.dispatch('languageChanged');
    expect(app.mute.getAttribute('aria-label')).toBe('開啟聲音');
    expect(app.play.getAttribute('aria-label')).toBe('播放影片');
  });

  it('dismisses tooltips with Escape until the control is hovered or focused again', async () => {
    const app = await readyApp();
    app.window.dispatch('keydown', { key: 'Escape' });
    expect(app.mute.classList.contains('tooltip-dismissed')).toBe(true);
    expect(app.play.classList.contains('tooltip-dismissed')).toBe(true);
    app.mute.dispatch('focus');
    expect(app.mute.classList.contains('tooltip-dismissed')).toBe(false);
  });
});

describe('hero video markup', () => {
  const html = readFileSync('index.html', 'utf8');

  it('keeps the poster layer, hidden controls and the versioned script', () => {
    expect(html).toMatch(/<div class="header-bg">\s*<div class="header-video" aria-hidden="true"><div id="header-video-player"><\/div><\/div>/);
    expect(html).toMatch(/id="header-video-mute"[^>]*hidden>/);
    expect(html).toMatch(/id="header-video-play-pause"[^>]*hidden>/);
    expect(html).toMatch(/assets\/js\/header-video\.js\?v=\d+/);
  });

  it('credits the official video and links the embed terms in the footer', () => {
    expect(html).toContain('href="https://www.youtube.com/watch?v=IdXhY6zGC4s"');
    expect(html).toContain('href="https://www.youtube.com/t/terms"');
    expect(html).toContain('href="https://policies.google.com/privacy"');
    expect(html).toContain('href="https://hololivepro.com/terms/"');
  });

  it.each(['ja', 'zh-TW', 'en'])('translates every new key in %s', lang => {
    const locale = JSON.parse(readFileSync(`assets/locales/${lang}.json`, 'utf8'));
    for (const key of ['mute', 'unmute', 'pause', 'play']) expect(locale.header_video[key]).toBeTruthy();
    for (const key of ['credit_video', 'credit_video_source', 'video_notice', 'youtube_terms', 'google_privacy', 'fan_guidelines']) {
      expect(locale.footer[key]).toBeTruthy();
    }
  });
});
