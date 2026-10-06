import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { checkExisting, loadReviewedEntries, parseOptions, taipeiDate, writeCuratedEntry } from '../../scripts/import-curated-fanart.mjs';

const helper = await import('../../functions/lib/fanart-link.js');
const { FieldValue } = createRequire(new URL('../../functions/package.json', import.meta.url))('firebase-admin/firestore');
const { entries } = loadReviewedEntries(helper);
const actor = { uid: 'fixture-owner', role: 'owner', sessionVersion: 2 };

function fixture({ existing = null, role = 'owner', version = 2, maintenance = true } = {}) {
  const documents = new Map([
    ['adminAccounts/fixture-owner', { role, sessionVersion: version, disabled: false }],
    ['system/maintenance', { enabled: maintenance }]
  ]);
  if (existing) documents.set(`fanart/${entries[0].id}`, existing);
  const writes = [];
  let generatedId = 0;
  const db = {
    collection: (name) => ({ doc: (id = `audit-${++generatedId}`) => ({ path: `${name}/${id}` }) }),
    runTransaction: async (callback) => {
      const pending = [];
      const result = await callback({
        get: async (ref) => ({ exists: documents.has(ref.path), data: () => documents.get(ref.path) }),
        create: (ref, data) => pending.push({ ref, data, operation: 'create' }),
        set: (ref, data, options) => pending.push({ ref, data, options, operation: 'set' })
      });
      for (const write of pending) {
        documents.set(write.ref.path, write.options?.merge
          ? { ...documents.get(write.ref.path), ...write.data } : write.data);
      }
      writes.push(...pending);
      return result;
    }
  };
  return { db, documents, writes };
}

describe('curated X importer safety and idempotence', () => {
  it('keeps the three human-reviewed references and abbreviated counts without invented integers', () => {
    expect(entries.map((entry) => entry.id)).toEqual([
      'x_1787157733575479363', 'x_1829450233501413859', 'x_1780135601498701835'
    ]);
    expect(entries.map((entry) => entry.observedLikeLabel)).toEqual(['679', '4.4K', '5.5K']);
    expect(entries.every((entry) => entry.humanVerifiedFanartTag === '#かなたーと')).toBe(true);
  });

  it('defaults to dry-run and refuses token arguments and missing production proof', () => {
    expect(parseOptions(['--project', 'kanata-memorial', '--owner-uid', actor.uid]).apply).toBe(false);
    expect(() => parseOptions(['--token', 'must-not-be-logged'])).toThrow('Unknown option');
    expect(() => parseOptions([
      '--project', 'kanata-memorial', '--owner-uid', actor.uid,
      '--apply', '--confirm-eligibility-date', taipeiDate()
    ])).toThrow('final --backup-operation');
    expect(() => parseOptions([
      '--project', 'kanata-memorial', '--owner-uid', actor.uid,
      '--apply', '--confirm-eligibility-date', '2020-01-01'
    ])).toThrow('today');
  });

  it('fails closed on an ID collision instead of treating unrelated data as a duplicate', () => {
    expect(() => checkExisting(entries[0], { exists: true, data: () => ({ sourceType: 'image' }) }))
      .toThrow('conflicts with existing content');
  });

  it('atomically creates content, lifetime count and audit while preserving daily and pending quotas', async () => {
    const state = fixture();
    const beforeStats = { dailyKey: '2026-10-04', dailyFanartCount: 2, pendingFanartCount: 1 };
    state.documents.set('userStats/fixture-owner', beforeStats);
    const data = { sourceType: 'x', postId: entries[0].post.postId, hidden: false, deleted: false };
    const call = () => writeCuratedEntry({ db: state.db, entry: entries[0], data, actor,
      audit: { action: 'fanart.import_curated' }, production: true });
    expect(await call()).toBe('added');
    expect(state.writes).toHaveLength(4);
    const stats = state.documents.get('userStats/fixture-owner');
    expect(stats.dailyFanartCount).toBe(2);
    expect(stats.pendingFanartCount).toBe(1);
    expect(stats.dailyKey).toBe('2026-10-04');
    expect(stats.fanartCount.isEqual(FieldValue.increment(1))).toBe(true);
    expect(state.documents.get('system/publicContentRevision').fanartRevision
      .isEqual(FieldValue.increment(1))).toBe(true);
    expect(await call()).toBe('skipped');
    expect(state.writes).toHaveLength(4);
  });

  it('never restores or overwrites a previously moderated duplicate', async () => {
    const original = { sourceType: 'x', postId: '', postUrl: '', hidden: true, deleted: true,
      moderation: { status: 'removed', reason: 'Existing decision' } };
    const state = fixture({ existing: original });
    expect(await writeCuratedEntry({ db: state.db, entry: entries[0], data: {}, actor,
      audit: {}, production: true })).toBe('skipped');
    expect(state.writes).toHaveLength(0);
    expect(state.documents.get(`fanart/${entries[0].id}`)).toBe(original);
  });

  it.each([{ role: 'moderator' }, { version: 3 }, { maintenance: false }])(
    'stops without writes when Owner authorization or maintenance changes: %j', async (change) => {
      const state = fixture(change);
      await expect(writeCuratedEntry({ db: state.db, entry: entries[0], data: {}, actor,
        audit: {}, production: true })).rejects.toThrow();
      expect(state.writes).toHaveLength(0);
    }
  );

  it('uses the Taipei calendar boundary for the fresh human-review confirmation', () => {
    expect(taipeiDate(new Date('2026-10-03T16:01:00Z'))).toBe('2026-10-04');
  });
});
