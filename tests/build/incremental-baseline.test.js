import { describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const script = resolve('scripts/capture-production-baseline.mjs');
const currentTag = 'governance-production-20261004T000000Z';
const previousTag = 'governance-production-20261003T000000Z';

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, stdio: 'pipe', encoding: 'utf8' });
}

function fixture(run) {
  const directory = mkdtempSync(join(tmpdir(), 'kanata-incremental-baseline-'));
  try {
    git(directory, 'init');
    git(directory, 'config', 'user.name', 'Baseline Test');
    git(directory, 'config', 'user.email', 'baseline@example.test');
    writeFileSync(join(directory, 'release.txt'), 'previous');
    git(directory, 'add', 'release.txt');
    git(directory, 'commit', '-m', 'Fixture previous release');
    git(directory, 'tag', '-a', previousTag, '-m', 'Previous fixture release');
    writeFileSync(join(directory, 'release.txt'), 'current');
    git(directory, 'add', 'release.txt');
    git(directory, 'commit', '-m', 'Fixture new release');
    git(directory, 'tag', '-a', currentTag, '-m', 'Current fixture release');
    return run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function capture(directory, previous = '') {
  return spawnSync(process.execPath, [script,
    '--project', 'kanata-memorial', '--confirm-production', 'kanata-memorial',
    '--release-tag', currentTag, '--incremental-release', '--apply',
    ...(previous ? ['--previous-release-tag', previous] : [])
  ], { cwd: directory, encoding: 'utf8' });
}

describe('incremental production baseline rollback prerequisites', () => {
  it('refuses an absent previous release before loading credentials or contacting production', () => {
    fixture((directory) => {
      const result = capture(directory);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('existing annotated --previous-release-tag');
    });
  });

  it('refuses the new revision as its own rollback baseline', () => {
    fixture((directory) => {
      const result = capture(directory, currentTag);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('currently deployed earlier revision');
    });
  });

  it('requires an approved admin Hosting target before obtaining credentials', () => {
    fixture((directory) => {
      writeFileSync(join(directory, '.firebaserc'), JSON.stringify({ targets: {
        'kanata-memorial': { hosting: { admin: ['unapproved-site'] } }
      } }));
      git(directory, 'add', '.firebaserc');
      git(directory, 'commit', '-m', 'Fixture target');
      git(directory, 'tag', '-d', currentTag);
      git(directory, 'tag', '-a', currentTag, '-m', 'Current fixture target');
      const result = capture(directory, previousTag);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('configured production admin Hosting target');
    });
  });
});
