import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = join(prefix, entry.name);
    return entry.isDirectory() ? files(join(directory, entry.name), relativePath) : [relativePath];
  });
}

const releaseGuardUrl = pathToFileURL(resolve('scripts/production-release-guard.mjs')).href;

function git(directory, ...args) {
  return execFileSync('git', args, { cwd: directory, encoding: 'utf8', stdio: 'pipe' });
}

function runReleaseGuard(directory, releaseTag) {
  const script = [
    `import { requireProductionReleaseTag } from ${JSON.stringify(releaseGuardUrl)};`,
    `requireProductionReleaseTag(${JSON.stringify(releaseTag)});`
  ].join('\n');
  return spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    cwd: directory,
    encoding: 'utf8'
  });
}

describe('production Hosting allowlists', () => {
  it('builds isolated public, admin, and maintenance outputs', () => {
    execFileSync('node', ['scripts/build-hosting.mjs', '--production'], { stdio: 'pipe' });

    expect(existsSync('.hosting-public/index.html')).toBe(true);
    expect(existsSync('.hosting-public/admin/index.html')).toBe(false);
    expect(existsSync('.hosting-admin/index.html')).toBe(true);
    expect(existsSync('.hosting-admin/auth/action/index.html')).toBe(true);
    expect(existsSync('.hosting-admin/assets/js/firebase-init.js')).toBe(true);
    expect(existsSync('.hosting-admin/vendor/lucide.min.js')).toBe(true);
    expect(existsSync('.hosting-admin/vendor/LUCIDE-LICENSE.txt')).toBe(true);
    expect(existsSync('.hosting-maintenance/index.html')).toBe(true);
    expect(readFileSync('.hosting-admin/index.html', 'utf8')).toContain('治理中心');
    expect(readFileSync('.hosting-maintenance/index.html', 'utf8')).toContain('noindex');

    for (const directory of ['.hosting-public', '.hosting-admin', '.hosting-maintenance']) {
      expect(files(directory).some((file) =>
        /(?:^|\/)(?:\.git|functions|scripts|tests|node_modules)(?:\/|$)/.test(file)
      )).toBe(false);
      expect(files(directory).some((file) => /(?:\.env|client_secret|service.?account)/i.test(file))).toBe(false);
    }
  });

  it('refuses production deployment without explicit confirmations', () => {
    const result = spawnSync('node', ['scripts/deploy-production.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing production deployment');
  });

  it('requires an annotated production release tag argument', () => {
    const result = spawnSync('node', [
      'scripts/deploy-production.mjs',
      '--project', 'kanata-memorial',
      '--confirm-production', 'kanata-memorial',
      '--phase', 'admin-preview'
    ], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--release-tag');
  });

  it('accepts only a clean HEAD selected by an annotated production release tag', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kanata-release-tag-'));
    const releaseTag = 'governance-production-20260711T000000Z';
    try {
      git(directory, 'init');
      git(directory, 'config', 'user.name', 'Release Guard Test');
      git(directory, 'config', 'user.email', 'release-guard@example.invalid');
      writeFileSync(join(directory, 'release.txt'), 'one\n');
      git(directory, 'add', 'release.txt');
      git(directory, 'commit', '-m', 'Initial release');

      git(directory, 'tag', releaseTag);
      const lightweight = runReleaseGuard(directory, releaseTag);
      expect(lightweight.status).not.toBe(0);
      expect(lightweight.stderr).toContain('annotated Git tag');

      git(directory, 'tag', '-d', releaseTag);
      git(directory, 'tag', '-a', releaseTag, '-m', 'Production release');
      expect(runReleaseGuard(directory, releaseTag).status).toBe(0);

      writeFileSync(join(directory, 'release.txt'), 'dirty\n');
      const dirty = runReleaseGuard(directory, releaseTag);
      expect(dirty.status).not.toBe(0);
      expect(dirty.stderr).toContain('dirty Git worktree');

      git(directory, 'add', 'release.txt');
      git(directory, 'commit', '-m', 'Post-tag change');
      const movedHead = runReleaseGuard(directory, releaseTag);
      expect(movedHead.status).not.toBe(0);
      expect(movedHead.stderr).toContain('does not point to the checked-out commit');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses an unconfirmed production Owner bootstrap', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kanata-production-guard-'));
    try {
      const result = spawnSync(process.execPath, [
        resolve('scripts/deploy-production.mjs'),
        '--project', 'kanata-memorial',
        '--confirm-production', 'kanata-memorial',
        '--phase', 'backend',
        '--release-tag', 'governance-production-20260711T000000Z',
        '--allow-owner-bootstrap'
      ], { cwd: directory, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Owner bootstrap guard failed');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('refuses Auth changes without a confirmed production site', () => {
    const result = spawnSync('node', ['scripts/configure-production-auth.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing Auth configuration');
  });

  it('refuses Auth apply without the exact Admin preview domain', () => {
    const result = spawnSync('node', ['scripts/configure-production-auth.mjs',
      '--project', 'kanata-memorial',
      '--confirm-production', 'kanata-memorial',
      '--admin-hosting-site', 'eienkanata-admin',
      '--apply'
    ], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('exact Admin Hosting preview domain');
  });

  it('refuses production Owner credential changes without a separate confirmation', () => {
    const result = spawnSync('node', ['scripts/prepare-production-owner.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing Owner preparation');
  });

  it('refuses an unconfirmed production maintenance state change', () => {
    const result = spawnSync('node', ['scripts/set-production-maintenance.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing maintenance state change');
  });

  it('refuses an unconfirmed production backup', () => {
    const result = spawnSync('node', ['scripts/backup-production.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing production backup');
  });

  it('refuses a production migration with the wrong Storage bucket', () => {
    const result = spawnSync('node', ['functions/lib/migrate-governance.js',
      '--project', 'kanata-memorial',
      '--confirm-production', 'kanata-memorial',
      '--storage-bucket', 'wrong-bucket.example',
      '--backup-operation', 'projects/kanata-memorial/databases/(default)/operations/example',
      '--apply'
    ], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Production apply requires --storage-bucket');
  });

  it('refuses an unconfirmed production baseline capture', () => {
    const result = spawnSync('node', ['scripts/capture-production-baseline.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing production baseline capture');
  });

  it('refuses an unconfirmed production Hosting setup', () => {
    const result = spawnSync('node', ['scripts/setup-production-hosting.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing production Hosting setup');
  });

  it('refuses an unconfirmed production backend verification', () => {
    const result = spawnSync('node', ['scripts/verify-production-backend.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing production backend verification');
  });

  it('refuses an unconfirmed production domain verification', () => {
    const result = spawnSync('node', ['scripts/verify-production-domains.mjs'], { encoding: 'utf8' });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Refusing production domain verification');
  });

  it('keeps both production Hosting targets explicit', () => {
    const config = JSON.parse(readFileSync('firebase.production.json', 'utf8'));
    const maintenance = JSON.parse(readFileSync('firebase.maintenance.json', 'utf8'));
    const projectConfig = JSON.parse(readFileSync('.firebaserc', 'utf8'));
    expect(config.hosting.map((site) => site.target)).toEqual(['public', 'admin']);
    expect(config.hosting[0].public).toBe('.hosting-public');
    expect(config.hosting[1].public).toBe('.hosting-admin');
    expect(projectConfig.targets?.['kanata-memorial']?.hosting).toEqual({
      public: ['kanata-memorial'],
      admin: ['eienkanata-admin']
    });
    expect(config.hosting.every((site) => site.rewrites?.[0]?.source === '/api/fanart-media')).toBe(true);
    expect(maintenance.hosting[0].rewrites?.[0]?.source).toBe('/api/fanart-media');
    const adminHeaders = config.hosting[1].headers[0].headers;
    const csp = adminHeaders.find((header) => header.key === 'Content-Security-Policy')?.value;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain('unpkg.com');
    expect(readFileSync('.hosting-admin/index.html', 'utf8')).not.toContain('unpkg.com');
    expect(readFileSync('.hosting-admin/admin-app.js', 'utf8')).not.toMatch(/\.style\./);
  });

  it('keeps final backup, DNS discovery, runtime, and bootstrap verification guards explicit', () => {
    const backup = readFileSync('scripts/backup-production.mjs', 'utf8');
    const lockChecks = [...backup.matchAll(/await verifyFinalMaintenanceLock\(\);/g)]
      .map((match) => match.index);
    const storageCopy = backup.indexOf('const [allFiles] = await bucket.getFiles();');
    const firestoreExport = backup.indexOf('const exportResponse = await fetch(');
    expect(lockChecks).toHaveLength(2);
    expect(lockChecks[0]).toBeLessThan(storageCopy);
    expect(lockChecks[1]).toBeGreaterThan(storageCopy);
    expect(lockChecks[1]).toBeLessThan(firestoreExport);

    const hostingSetup = readFileSync('scripts/setup-production-hosting.mjs', 'utf8');
    expect(hostingSetup).toContain('Array.isArray(value.desired) && value.desired.length > 0');

    const backendVerification = readFileSync('scripts/verify-production-backend.mjs', 'utf8');
    expect(backendVerification).toContain("buildConfig?.runtime !== 'nodejs22'");
    expect(backendVerification).toContain("['enabled', 'disabled'].includes(expectedBootstrapState)");
    expect(backendVerification).not.toContain('deployedBootstrapUid,');
  });
});
