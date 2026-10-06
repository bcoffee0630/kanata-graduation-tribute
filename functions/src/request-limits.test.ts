import { describe, expect, it } from 'vitest';
import { endpointWindow } from './request-limits.js';

describe('authenticated rolling endpoint limits', () => {
  it('allows five submission/report attempts and returns the real remaining wait on the sixth', () => {
    for (const endpoint of ['submitMessage', 'submitFanartLink', 'submitReport'] as const) {
      let attempts: number[] = [];
      for (let index = 0; index < 5; index += 1) {
        const result = endpointWindow(attempts, endpoint, 100_000 + index * 1000);
        expect(result.allowed).toBe(true); attempts = result.attempts;
      }
      expect(endpointWindow(attempts, endpoint, 110_000)).toMatchObject({ allowed: false, retryAfterSeconds: 50 });
      const renewed = endpointWindow(attempts, endpoint, 160_000);
      expect(renewed.allowed).toBe(true);
      expect(renewed.attempts).toEqual([101_000, 102_000, 103_000, 104_000, 160_000]);
    }
  });
  it('uses a separate twenty-attempt window for quota lookups', () => {
    const attempts = Array.from({ length: 19 }, (_, index) => 100_000 + index);
    expect(endpointWindow(attempts, 'getMyContributionLimits', 101_000).allowed).toBe(true);
    expect(endpointWindow([...attempts, 101_000], 'getMyContributionLimits', 102_000))
      .toMatchObject({ allowed: false, retryAfterSeconds: 58 });
  });
  it('fails closed on corrupted state and conservatively retains attempts ahead of the current clock', () => {
    for (const value of [null, 'five', [NaN], [-1], [1.5], Array(21).fill(1)]) {
      expect(() => endpointWindow(value, 'submitMessage', 100_000)).toThrow();
    }
    expect(endpointWindow(Array(5).fill(101_000), 'submitMessage', 100_000))
      .toMatchObject({ allowed: false, retryAfterSeconds: 61 });
    expect(endpointWindow(undefined, 'submitMessage', 100_000).allowed).toBe(true);
  });
});
