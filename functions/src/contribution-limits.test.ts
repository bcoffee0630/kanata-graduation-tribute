import { describe, expect, it } from 'vitest';
import { todayKey } from './core.js';
import {
  assertContributionAvailable,
  buildContributionLimitSnapshot,
  contributionRevision,
  currentContributionUsage,
  parseContributionDefaults,
  parseContributionOverride,
  parseStoredContributionOverride,
  requiredContributionLimit,
  requiredContributionUid
} from './contribution-limits.js';

describe('contribution limit policy', () => {
  it('retains 3 messages / 2 fan art submissions until defaults are configured', () => {
    expect(buildContributionLimitSnapshot({}, {}, {}, '2026-10-05')).toEqual({
      defaults: { messageDailyLimit: 3, fanartDailyLimit: 2 },
      overrides: { message: { mode: 'inherit' }, fanart: { mode: 'inherit' } },
      effective: { message: { limit: 3, source: 'default' }, fanart: { limit: 2, source: 'default' } },
      usage: { message: 0, fanart: 0 },
      dayKey: '2026-10-05',
      revision: 0
    });
  });

  it('falls back independently for missing or invalid stored defaults', () => {
    expect(parseContributionDefaults({ messageDailyLimit: 0 })).toEqual({
      messageDailyLimit: 0, fanartDailyLimit: 2
    });
    for (const invalid of [null, '0', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseContributionDefaults({ messageDailyLimit: invalid, fanartDailyLimit: invalid })).toEqual({
        messageDailyLimit: 3, fanartDailyLimit: 2
      });
      expect(parseStoredContributionOverride(invalid)).toEqual(
        invalid === null ? { mode: 'unlimited' } : { mode: 'inherit' }
      );
    }
  });

  it('accepts zero and the largest safe finite limit, without number coercion', () => {
    expect(requiredContributionLimit(0, 'limit')).toBe(0);
    expect(requiredContributionLimit(Number.MAX_SAFE_INTEGER, 'limit')).toBe(Number.MAX_SAFE_INTEGER);
    for (const invalid of [undefined, null, true, '3', -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => requiredContributionLimit(invalid, 'limit')).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    }
  });

  it('requires an explicit supported override mode and validates only finite mode values', () => {
    expect(parseContributionOverride({ mode: 'inherit' }, 'message')).toEqual({ mode: 'inherit' });
    expect(parseContributionOverride({ mode: 'unlimited' }, 'fanart')).toEqual({ mode: 'unlimited' });
    expect(parseContributionOverride({ mode: 'limited', value: 0 }, 'message')).toEqual({ mode: 'limited', value: 0 });
    for (const invalid of [
      undefined, null, [], 'unlimited', {}, { mode: 'default' },
      { mode: 'limited' }, { mode: 'limited', value: null }, { mode: 'limited', value: -1 },
      { mode: 'unlimited', value: 3 }, { mode: 'inherit', value: null }
    ]) {
      expect(() => parseContributionOverride(invalid, 'message')).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    }
  });

  it('supports independent overrides and tracks counts even with unlimited access', () => {
    const snapshot = buildContributionLimitSnapshot(
      { messageDailyLimit: 7, fanartDailyLimit: 4 },
      { messageDailyLimit: null, fanartDailyLimit: 0, revision: 6 },
      { dailyKey: '2026-10-05', dailyMessageCount: 20, dailyFanartCount: 1 },
      '2026-10-05'
    );
    expect(snapshot.overrides).toEqual({ message: { mode: 'unlimited' }, fanart: { mode: 'limited', value: 0 } });
    expect(snapshot.effective).toEqual({ message: { limit: null, source: 'override' }, fanart: { limit: 0, source: 'override' } });
    expect(snapshot.usage).toEqual({ message: 20, fanart: 1 });
    expect(snapshot.revision).toBe(6);
    expect(() => assertContributionAvailable(snapshot, 'message')).not.toThrow();
    expect(() => assertContributionAvailable(snapshot, 'fanart')).toThrow(expect.objectContaining({
      code: 'resource-exhausted',
      details: { reason: 'daily_limit', contentType: 'fanart', limit: 0, used: 1, dayKey: '2026-10-05' }
    }));
  });

  it('raising, lowering, or removing overrides preserves the same accumulated usage', () => {
    const stats = { dailyKey: '2026-10-05', dailyMessageCount: 5, dailyFanartCount: 2 };
    const finite = (value: number | undefined) => buildContributionLimitSnapshot(
      { messageDailyLimit: 6 },
      value === undefined ? { revision: 3 } : { messageDailyLimit: value, revision: 2 },
      stats, '2026-10-05'
    );
    expect(() => assertContributionAvailable(finite(6), 'message')).not.toThrow();
    expect(() => assertContributionAvailable(finite(4), 'message')).toThrow(expect.objectContaining({
      details: { reason: 'daily_limit', contentType: 'message', limit: 4, used: 5, dayKey: '2026-10-05' }
    }));
    expect(finite(undefined).effective.message).toEqual({ limit: 6, source: 'default' });
    expect(finite(undefined).usage.message).toBe(5);
  });

  it('inherits newly changed defaults without changing explicit overrides', () => {
    const overrides = { fanartDailyLimit: 9 };
    expect(buildContributionLimitSnapshot({ messageDailyLimit: 4 }, overrides).effective).toEqual({
      message: { limit: 4, source: 'default' }, fanart: { limit: 9, source: 'override' }
    });
    expect(buildContributionLimitSnapshot({ messageDailyLimit: 0 }, overrides).effective).toEqual({
      message: { limit: 0, source: 'default' }, fanart: { limit: 9, source: 'override' }
    });
  });

  it('rolls over both daily counts at Taipei midnight without depending on UTC midnight', () => {
    const stats = { dailyKey: '2026-10-05', dailyMessageCount: 3, dailyFanartCount: 2, pendingFanartCount: 1 };
    const before = todayKey(new Date('2026-10-05T15:59:59.999Z'));
    const after = todayKey(new Date('2026-10-05T16:00:00.000Z'));
    expect(currentContributionUsage(stats, before)).toEqual({ message: 3, fanart: 2, pending: 1 });
    expect(currentContributionUsage(stats, after)).toEqual({ message: 0, fanart: 0, pending: 0 });
    expect(() => assertContributionAvailable(buildContributionLimitSnapshot({}, {}, stats, before), 'message')).toThrow();
    expect(() => assertContributionAvailable(buildContributionLimitSnapshot({}, {}, stats, after), 'message')).not.toThrow();
  });

  it('does not let malformed stored values silently grant unlimited access', () => {
    const snapshot = buildContributionLimitSnapshot(
      { messageDailyLimit: null }, { messageDailyLimit: 'unlimited', fanartDailyLimit: -1 }
    );
    expect(snapshot.effective).toEqual({ message: { limit: 3, source: 'default' }, fanart: { limit: 2, source: 'default' } });
    expect(currentContributionUsage({ dailyKey: '2026-10-05', dailyMessageCount: -1, dailyFanartCount: '2' }, '2026-10-05'))
      .toEqual({ message: 0, fanart: 0, pending: 0 });
  });

  it('validates UIDs before creating a Firestore reference and retains revision zero', () => {
    expect(requiredContributionUid(' user-1 ')).toBe('user-1');
    for (const invalid of ['', '   ', 'parent/user', null, 'x'.repeat(129)]) {
      expect(() => requiredContributionUid(invalid)).toThrow(expect.objectContaining({ code: 'invalid-argument' }));
    }
    expect(contributionRevision()).toBe(0);
    expect(contributionRevision({ revision: 0 })).toBe(0);
    expect(contributionRevision({ revision: '1' })).toBe(0);
    expect(contributionRevision({ revision: 2 })).toBe(2);
  });
});
