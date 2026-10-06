import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildXFanartData,
  parseXPostUrl,
  resolveXPostOembedEndpoint,
  verifyXPost,
  xFanartSampleKey,
  xFanartDocumentId
} from './fanart-link.js';

const postId = '1993918268065239540';
const post = parseXPostUrl(`https://x.com/originalArtist/status/${postId}`);
const publicEmbed = () => new Response(JSON.stringify({
  type: 'rich',
  html: `<blockquote class="twitter-tweet"><a href="https://twitter.com/originalArtist/status/${postId}?ref_src=twsrc%5Etfw">Post</a></blockquote>`
}));

afterEach(() => vi.unstubAllEnvs());

describe('X fan art links', () => {
  it('assigns stable bounded sample keys to historical and new post IDs', () => {
    const keys = [postId, '1', '1990000000000000001', '1990000000000000002'].map(xFanartSampleKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every(key => key >= 0 && key < 1)).toBe(true);
    expect(xFanartSampleKey(postId)).toBe(xFanartSampleKey(postId));
    expect(buildXFanartData({ post, submitter: { uid: 'author', displayName: 'Author', avatarUrl: '', providerId: 'google.com', profileLink: '' }, createdAt: null }).sampleKey).toBe(keys[0]);
  });
  it('keeps post IDs as strings and strips share parameters and media suffixes', () => {
    expect(parseXPostUrl(` https://mobile.twitter.com/originalArtist/status/${postId}/photo/1?s=20#share `)).toEqual(post);
    expect(parseXPostUrl(`https://www.x.com/originalArtist/status/${postId}/video/4/`)).toEqual(post);
    expect(parseXPostUrl(`https://twitter.com/i/status/${postId}`)).toEqual({
      postId, postUrl: `https://x.com/i/web/status/${postId}`
    });
    expect(xFanartDocumentId(post)).toBe(`x_${postId}`);
  });

  it.each([
    `http://x.com/originalArtist/status/${postId}`,
    `https://x.com.attacker.test/originalArtist/status/${postId}`,
    `https://attacker@x.com/originalArtist/status/${postId}`,
    `https://x.com:8443/originalArtist/status/${postId}`,
    'https://x.com/originalArtist',
    'https://x.com/originalArtist/status/012345',
    'https://x.com/originalArtist/status/1e10',
    'https://x.com/originalArtist/status/12345678901234567890123456',
    `https://x.com/originalArtist/status/${postId}/photo/5`,
    `https://x.com/originalArtist/status/${postId}/other`,
    `https://x.com\\originalArtist/status/${postId}`,
    '<script>alert(1)</script>',
    null
  ])('rejects URLs that are not an allowed post: %s', (value) => {
    expect(() => parseXPostUrl(value)).toThrow(expect.objectContaining({
      code: 'invalid-argument', details: { reason: 'invalid_post_url' }
    }));
  });

  it('checks the fixed official endpoint without following redirects or storing embed HTML', async () => {
    const fetchImpl = vi.fn(async () => publicEmbed());
    await verifyXPost(post, { fetchImpl });
    const [requestUrl, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect(requestUrl.origin).toBe('https://publish.x.com');
    expect(requestUrl.pathname).toBe('/oembed');
    expect(requestUrl.searchParams.get('url')).toBe(post.postUrl);
    expect(requestUrl.searchParams.get('omit_script')).toBe('true');
    expect(init.redirect).toBe('error');
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([400, 403, 404, 410])('rejects unavailable posts reported by X (%s)', async (status) => {
    await expect(verifyXPost(post, { fetchImpl: async () => new Response('', { status }) })).rejects.toMatchObject({
      code: 'failed-precondition', details: { reason: 'post_unavailable' }
    });
  });

  it.each([429, 500, 503])('makes temporary X errors retryable (%s)', async (status) => {
    await expect(verifyXPost(post, { fetchImpl: async () => new Response('', { status }) })).rejects.toMatchObject({
      code: 'unavailable', details: { reason: 'x_service_unavailable' }
    });
  });

  it('fails closed on a bad response or an embed for another post', async () => {
    for (const body of ['not JSON', '{}', JSON.stringify({
      type: 'rich', html: '<blockquote class="twitter-tweet"><a href="https://x.com/artist/status/123">Wrong post</a></blockquote>'
    })]) {
      await expect(verifyXPost(post, { fetchImpl: async () => new Response(body) })).rejects.toMatchObject({
        code: 'unavailable', details: { reason: 'x_service_unavailable' }
      });
    }
  });

  it('maps network failure and request timeout to a retryable error', async () => {
    await expect(verifyXPost(post, { fetchImpl: async () => { throw new Error('Network error'); } })).rejects.toMatchObject({
      code: 'unavailable', details: { reason: 'x_service_unavailable' }
    });
    const fetchImpl: typeof fetch = async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
    });
    await expect(verifyXPost(post, { fetchImpl, timeoutMs: 5 })).rejects.toMatchObject({
      code: 'unavailable', details: { reason: 'x_service_unavailable' }
    });
  });

  it('honors the fixed localhost fixture only in a demo Functions emulator', () => {
    const fixture = 'http://127.0.0.1:9394/oembed';
    expect(resolveXPostOembedEndpoint({
      FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-kanata-governance', X_OEMBED_EMULATOR_URL: fixture
    })).toBe(fixture);
    for (const environment of [
      { FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'kanata-memorial', X_OEMBED_EMULATOR_URL: fixture },
      { FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-kanata-governance', GOOGLE_CLOUD_PROJECT: 'kanata-memorial', X_OEMBED_EMULATOR_URL: fixture },
      { GCLOUD_PROJECT: 'demo-kanata-governance', X_OEMBED_EMULATOR_URL: fixture },
      { FUNCTIONS_EMULATOR: 'true', GCLOUD_PROJECT: 'demo-kanata-governance', X_OEMBED_EMULATOR_URL: 'http://169.254.169.254/oembed' }
    ]) {
      expect(resolveXPostOembedEndpoint(environment)).toBe('https://publish.x.com/oembed');
    }
  });

  it('stores the website submitter separately from the X author', () => {
    const submitter = {
      uid: 'curator-owner', displayName: 'Website Curator', avatarUrl: '', providerId: 'password', profileLink: ''
    };
    const data = buildXFanartData({ post, submitter, createdAt: 'server-timestamp', submissionSource: 'curated' });
    expect(data).toMatchObject({
      artist: 'Website Curator', artistId: 'curator-owner', artistProvider: 'password', submitter,
      postId, postUrl: post.postUrl, sourceType: 'x', submissionSource: 'curated',
      caption: '', imagePath: '', imageUrl: '', hidden: false, deleted: false, reportCount: 0,
      moderation: { status: 'visible' }
    });
    expect(data).not.toHaveProperty('html');
  });
});
