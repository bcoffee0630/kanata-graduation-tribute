import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

function element(extra = {}) {
  const attributes = new Map();
  const listeners = new Map();
  const icons = { share: { hidden: false }, link: { hidden: true } };
  for (const icon of Object.values(icons)) {
    icon.toggleAttribute = (name, force) => { icon.hidden = force; };
  }
  return {
    icons, listeners, title: '', href: '',
    setAttribute: (name, value) => attributes.set(name, value),
    getAttribute: name => attributes.get(name),
    addEventListener: (type, callback) => listeners.set(type, callback),
    querySelector: selector => icons[selector.match(/data-share-icon="(\w+)"/)?.[1]] || null,
    ...extra,
  };
}

function runtime({ href = 'https://eienkanata.com/?utm_source=test#gallery-section', share, clipboard, finePointer = true, lang, lexicalToast } = {}) {
  const xLink = element();
  const nativeButton = element();
  const windowListeners = new Map();
  const window = {
    location: new URL(href),
    open: vi.fn(),
    matchMedia: () => ({ matches: finePointer }),
    addEventListener: (type, callback) => windowListeners.set(type, callback),
    Toast: lexicalToast ? undefined : { success: vi.fn(), error: vi.fn() },
    i18n: lang,
  };
  const document = {
    title: '天音彼方 粉絲紀念站 | Amane Kanata Fan Tribute - Day 288',
    getElementById: id => ({ 'share-twitter': xLink, 'share-native': nativeButton }[id] || null),
    querySelector: selector => selector === 'meta[property="og:url"]' ? { content: 'https://eienkanata.com/' } : null,
    createElement: () => ({ setAttribute() {}, select() {}, remove() {} }),
    body: { append() {} },
    execCommand: vi.fn(() => false),
  };
  const navigator = { share, clipboard };
  const globals = { window, document, navigator, URL };
  if (lexicalToast) globals.Toast = lexicalToast;
  runInNewContext(readFileSync('assets/js/share.js', 'utf8'), globals);
  return { window, document, xLink, nativeButton, dispatch: type => windowListeners.get(type)?.() };
}

describe('footer sharing', () => {
  it('shares the canonical site without the visitor section anchor or tracking query', () => {
    const { window, xLink } = runtime();
    expect(window.Share.canonicalUrl()).toBe('https://eienkanata.com/');
    const intent = new URL(xLink.href);
    expect(`${intent.origin}${intent.pathname}`).toBe('https://x.com/intent/post');
    expect(intent.searchParams.get('url')).toBe('https://eienkanata.com/');
    expect(intent.searchParams.get('text')).toContain('#天音かなた');
  });

  it('opens a compact composer on desktop and lets touch devices follow the link to the X app', () => {
    const desktop = runtime();
    const desktopEvent = { preventDefault: vi.fn() };
    desktop.xLink.listeners.get('click')(desktopEvent);
    expect(desktopEvent.preventDefault).toHaveBeenCalled();
    expect(desktop.window.open).toHaveBeenCalledWith(desktop.xLink.href, 'share-on-x', expect.stringContaining('noopener'));

    const touch = runtime({ finePointer: false });
    const touchEvent = { preventDefault: vi.fn() };
    touch.xLink.listeners.get('click')(touchEvent);
    expect(touchEvent.preventDefault).not.toHaveBeenCalled();
    expect(touch.window.open).not.toHaveBeenCalled();
  });

  it('passes the current localized title, post text and canonical URL to the device share sheet', async () => {
    const share = vi.fn(async () => {});
    const { nativeButton } = runtime({ share, lang: { t: key => key === 'footer.post_text' ? '謝謝你，天音彼方 #天音かなた' : key } });
    expect(nativeButton.getAttribute('aria-label')).toBe('Share');
    expect(nativeButton.icons.share.hidden).toBe(false);
    await nativeButton.listeners.get('click')();
    expect(share).toHaveBeenCalledWith({
      title: '天音彼方 粉絲紀念站 | Amane Kanata Fan Tribute - Day 288', text: '謝謝你，天音彼方 #天音かなた', url: 'https://eienkanata.com/',
    });
  });

  it('treats a dismissed share sheet as a normal choice without copying', async () => {
    const writeText = vi.fn(async () => {});
    const share = vi.fn(async () => { throw Object.assign(new Error('closed'), { name: 'AbortError' }); });
    const { window, nativeButton } = runtime({ share, clipboard: { writeText } });
    await nativeButton.listeners.get('click')();
    expect(writeText).not.toHaveBeenCalled();
    expect(window.Toast.success).not.toHaveBeenCalled();
    expect(window.Toast.error).not.toHaveBeenCalled();
  });

  it('turns into a copy-link button where the Web Share API is unavailable', async () => {
    const writeText = vi.fn(async () => {});
    const { window, nativeButton } = runtime({ clipboard: { writeText } });
    expect(nativeButton.getAttribute('aria-label')).toBe('Copy link');
    expect(nativeButton.icons.share.hidden).toBe(true);
    expect(nativeButton.icons.link.hidden).toBe(false);
    await nativeButton.listeners.get('click')();
    expect(writeText).toHaveBeenCalledWith('https://eienkanata.com/');
    expect(window.Toast.success).toHaveBeenCalledWith('Link copied.');
  });

  it('uses the page Toast declared by toast.js, which is not a window property', async () => {
    const Toast = { success: vi.fn(), error: vi.fn() };
    const { nativeButton } = runtime({ clipboard: { writeText: vi.fn(async () => {}) }, lexicalToast: Toast });
    await nativeButton.listeners.get('click')();
    expect(Toast.success).toHaveBeenCalledWith('Link copied.');
  });

  it('shows the link in an error notification when no copy method succeeds', async () => {
    const { window, nativeButton } = runtime({ clipboard: { writeText: vi.fn(async () => { throw new Error('denied'); }) } });
    await nativeButton.listeners.get('click')();
    expect(window.Toast.error).toHaveBeenCalledWith('The link could not be copied. https://eienkanata.com/');
  });

  it('retranslates labels and the intent text when the language changes', () => {
    const { window, xLink, nativeButton, dispatch } = runtime();
    window.i18n = { t: key => ({ 'footer.share_x': '分享到 X', 'footer.copy_link': '複製連結', 'footer.post_text': '謝謝你，天音彼方' }[key] || key) };
    dispatch('languageChanged');
    expect(xLink.getAttribute('aria-label')).toBe('分享到 X');
    expect(nativeButton.getAttribute('aria-label')).toBe('複製連結');
    expect(new URL(xLink.href).searchParams.get('text')).toBe('謝謝你，天音彼方');
  });
});
