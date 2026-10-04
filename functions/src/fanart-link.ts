import { HttpsError } from 'firebase-functions/v2/https';
import type { SubmitterSnapshot } from './core.js';

export interface ParsedXPost {
  postId: string;
  postUrl: string;
}

const X_HOSTS = new Set([
  'x.com', 'www.x.com', 'twitter.com', 'www.twitter.com', 'mobile.twitter.com'
]);
const OFFICIAL_OEMBED_ENDPOINT = 'https://publish.x.com/oembed';
const EMULATOR_OEMBED_ENDPOINTS = new Set([
  'http://127.0.0.1:9394/oembed', 'http://localhost:9394/oembed'
]);

export function parseXPostUrl(value: unknown): ParsedXPost {
  const invalid = () => new HttpsError(
    'invalid-argument',
    'Enter a valid HTTPS X or Twitter post URL.',
    { reason: 'invalid_post_url' }
  );
  if (typeof value !== 'string') throw invalid();
  const normalized = value.trim();
  if (normalized.length > 500 || !normalized.startsWith('https://') || /[\\\x00-\x20]/.test(normalized)) {
    throw invalid();
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw invalid();
  }
  if (!X_HOSTS.has(url.hostname) || url.username || url.password || url.port) throw invalid();
  const match = url.pathname.match(
    /^\/([A-Za-z0-9_]{1,15}|i\/web)\/status\/([1-9]\d{0,24})(?:\/(?:photo|video)\/[1-4])?\/?$/
  );
  if (!match?.[1] || !match[2]) throw invalid();
  const namespace = match[1] === 'i' ? 'i/web' : match[1];
  return { postId: match[2], postUrl: `https://x.com/${namespace}/status/${match[2]}` };
}

export function xFanartDocumentId(post: ParsedXPost): string {
  return `x_${post.postId}`;
}

export function resolveXPostOembedEndpoint(environment: NodeJS.ProcessEnv = process.env): string {
  const projects = [environment.GCLOUD_PROJECT, environment.GOOGLE_CLOUD_PROJECT, environment.GCP_PROJECT]
    .filter((project): project is string => Boolean(project));
  const override = environment.X_OEMBED_EMULATOR_URL || '';
  if (environment.FUNCTIONS_EMULATOR === 'true' && projects.length > 0 &&
      projects.every((project) => project.startsWith('demo-')) && EMULATOR_OEMBED_ENDPOINTS.has(override)) {
    return override;
  }
  return OFFICIAL_OEMBED_ENDPOINT;
}

export async function verifyXPost(
  post: ParsedXPost,
  options: { fetchImpl?: typeof fetch; timeoutMs?: number } = {}
): Promise<void> {
  const endpoint = new URL(resolveXPostOembedEndpoint());
  endpoint.searchParams.set('url', post.postUrl);
  endpoint.searchParams.set('omit_script', 'true');
  endpoint.searchParams.set('dnt', 'true');
  const unavailable = () => new HttpsError(
    'unavailable',
    'X could not verify this post. Please try again later.',
    { reason: 'x_service_unavailable' }
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 5000);
  try {
    const response = await (options.fetchImpl || fetch)(endpoint, {
      signal: controller.signal,
      redirect: 'error',
      headers: { Accept: 'application/json' }
    });
    if ([400, 403, 404, 410].includes(response.status)) {
      throw new HttpsError(
        'failed-precondition',
        'This X post is unavailable or cannot be embedded. Choose a public original post.',
        { reason: 'post_unavailable' }
      );
    }
    if (!response.ok) throw unavailable();
    const body = await response.text();
    if (body.length > 100_000) throw unavailable();
    const payload: unknown = JSON.parse(body);
    if (!payload || typeof payload !== 'object') throw unavailable();
    const embed = payload as Record<string, unknown>;
    if (embed.type !== 'rich' || typeof embed.html !== 'string' ||
        !embed.html.includes('twitter-tweet') ||
        !new RegExp(`/status/${post.postId}(?:[?"'<>\\s]|$)`).test(embed.html)) {
      throw unavailable();
    }
  } catch (error) {
    if (error instanceof HttpsError) throw error;
    throw unavailable();
  } finally {
    clearTimeout(timeout);
  }
}

export function buildXFanartData(input: {
  post: ParsedXPost;
  caption?: string;
  submitter: SubmitterSnapshot;
  createdAt: unknown;
  submissionSource?: 'community' | 'curated';
}): Record<string, unknown> {
  const { post, submitter } = input;
  return {
    sourceType: 'x',
    submissionSource: input.submissionSource || 'community',
    postId: post.postId,
    postUrl: post.postUrl,
    artist: submitter.displayName,
    artistId: submitter.uid,
    artistLink: submitter.profileLink,
    artistAvatar: submitter.avatarUrl,
    artistProvider: submitter.providerId,
    submitter,
    imagePath: '',
    imageUrl: '',
    caption: input.caption || '',
    createdAt: input.createdAt,
    hidden: false,
    deleted: false,
    reportCount: 0,
    moderation: { status: 'visible', updatedAt: null, updatedBy: '', reason: '' }
  };
}
