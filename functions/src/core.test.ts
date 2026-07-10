import { describe, expect, it } from 'vitest';
import {
  isPasswordSignIn,
  optionalHttpsUrl,
  parseAdminRole,
  requireContributorAuth,
  requiredString,
  todayKey,
  validatedFanartStoragePath
} from './core.js';

describe('governance validation helpers', () => {
  it('uses the Taipei calendar day for rate limits', () => {
    expect(todayKey(new Date('2026-01-01T15:59:59.000Z'))).toBe('2026-01-01');
    expect(todayKey(new Date('2026-01-01T16:00:00.000Z'))).toBe('2026-01-02');
  });

  it('normalizes bounded text', () => {
    expect(requiredString('  hello  ', 'content', 3, 10)).toBe('hello');
    expect(() => requiredString('x', 'content', 3, 10)).toThrow();
  });

  it('accepts only HTTPS profile links', () => {
    expect(optionalHttpsUrl('https://example.com/user', 'profile')).toBe('https://example.com/user');
    expect(() => optionalHttpsUrl('javascript:alert(1)', 'profile')).toThrow();
    expect(() => optionalHttpsUrl('http://example.com', 'profile')).toThrow();
  });

  it('recognizes only supported administrator roles', () => {
    expect(parseAdminRole('owner')).toBe('owner');
    expect(parseAdminRole('moderator')).toBe('moderator');
    expect(parseAdminRole('admin')).toBeNull();
  });

  it('requires the password provider for administrator sessions', () => {
    expect(isPasswordSignIn({ firebase: { sign_in_provider: 'password' } } as never)).toBe(true);
    expect(isPasswordSignIn({ firebase: { sign_in_provider: 'google.com' } } as never)).toBe(false);
    expect(isPasswordSignIn({ firebase: undefined } as never)).toBe(false);
  });

  it('limits public contributions to the existing social providers', () => {
    const request = (provider: string) => ({
      auth: { uid: 'test-user', token: { firebase: { sign_in_provider: provider } } }
    }) as never;
    expect(requireContributorAuth(request('google.com')).uid).toBe('test-user');
    expect(requireContributorAuth(request('github.com')).uid).toBe('test-user');
    expect(() => requireContributorAuth(request('password'))).toThrow();
  });

  it('accepts only Storage objects owned by the fan art document', () => {
    expect(validatedFanartStoragePath(
      'fanart-1',
      'artist-1',
      'fanart/artist-1/fanart-1/original.png'
    )).toBe('fanart/artist-1/fanart-1/original.png');
    expect(validatedFanartStoragePath(
      'fanart-1',
      'artist-1',
      'fanart/another-user/fanart-1/original.png'
    )).toBe('');
    expect(validatedFanartStoragePath(
      'fanart-1',
      'artist-1',
      'fanart/artist-1/fanart-1/nested/original.png'
    )).toBe('');
  });
});
