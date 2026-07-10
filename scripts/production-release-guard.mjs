import { spawnSync } from 'node:child_process';

const RELEASE_TAG_PATTERN = /^governance-production-\d{8}T\d{6}Z$/;

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`Unable to verify the production release tag: git ${args.join(' ')}`);
  }
  return result.stdout.trim();
}

export function requireProductionReleaseTag(releaseTag) {
  if (!RELEASE_TAG_PATTERN.test(String(releaseTag || ''))) {
    throw new Error(
      'Production changes require --release-tag governance-production-YYYYMMDDTHHMMSSZ.'
    );
  }

  if (git(['status', '--porcelain'])) {
    throw new Error('Refusing production changes from a dirty Git worktree.');
  }

  const ref = `refs/tags/${releaseTag}`;
  if (git(['cat-file', '-t', ref]) !== 'tag') {
    throw new Error('The production release marker must be an annotated Git tag.');
  }

  const head = git(['rev-parse', 'HEAD']);
  const taggedCommit = git(['rev-parse', `${ref}^{commit}`]);
  if (taggedCommit !== head) {
    throw new Error('The production release tag does not point to the checked-out commit.');
  }

  return { releaseTag, commit: head };
}
