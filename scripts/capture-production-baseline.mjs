import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

const PROJECT = 'kanata-memorial';
const PUBLIC_SITE = 'kanata-memorial';
const MANIFEST_DIRECTORY = '.production-backups';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || '') : '';
}

if (
  argument('--project') !== PROJECT ||
  argument('--confirm-production') !== PROJECT ||
  !process.argv.includes('--apply')
) {
  console.error('Refusing production baseline capture without explicit project confirmation and --apply.');
  process.exit(1);
}

const release = requireProductionReleaseTag(argument('--release-tag'));

function gitValue(args) {
  const result = spawnSync('git', args, { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`Unable to read Git baseline: git ${args.join(' ')}`);
  return result.stdout.trim();
}

const credential = applicationDefault();
const app = initializeApp({ projectId: PROJECT, credential });
const auth = getAuth(app);
const accessToken = await credential.getAccessToken();
const headers = {
  Authorization: `Bearer ${accessToken.access_token}`,
  'X-Goog-User-Project': PROJECT
};

async function getJson(url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Production baseline request failed (${response.status}).`);
  return response.json();
}

const [hosting, rules, authConfig, providers, projectConfig] = await Promise.all([
  getJson(
    `https://firebasehosting.googleapis.com/v1beta1/sites/${PUBLIC_SITE}/channels/live/releases?pageSize=100`
  ),
  getJson(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases?pageSize=100`),
  getJson(`https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/config`),
  getJson(
    `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}/defaultSupportedIdpConfigs?pageSize=100`
  ),
  auth.projectConfigManager().getProjectConfig()
]);

const liveRelease = [...(hosting.releases || [])]
  .sort((left, right) => String(right.releaseTime || '').localeCompare(String(left.releaseTime || '')))[0];
if (!liveRelease?.name || !liveRelease?.version?.name) {
  throw new Error('The current public Hosting live release could not be identified.');
}

const ruleReleases = (rules.releases || [])
  .filter((release) => /\/releases\/(cloud\.firestore|firebase\.storage)/.test(release.name || ''))
  .map((release) => ({
    name: release.name,
    rulesetName: release.rulesetName,
    updateTime: release.updateTime || ''
  }));
if (!ruleReleases.some((release) => release.name.endsWith('/cloud.firestore'))) {
  throw new Error('The current Cloud Firestore Rules release could not be identified.');
}
if (!ruleReleases.some((release) => release.name.includes('/firebase.storage/'))) {
  throw new Error('The current Cloud Storage Rules release could not be identified.');
}

const providerStates = Object.fromEntries((providers.defaultSupportedIdpConfigs || []).map((provider) => [
  String(provider.name || '').split('/').at(-1),
  provider.enabled === true
]));

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const baseline = {
  projectId: PROJECT,
  capturedAt: new Date().toISOString(),
  git: {
    commit: release.commit,
    branch: gitValue(['branch', '--show-current']),
    releaseTag: release.releaseTag
  },
  hosting: {
    site: PUBLIC_SITE,
    releaseName: liveRelease.name,
    versionName: liveRelease.version.name,
    releaseTime: liveRelease.releaseTime || ''
  },
  rules: ruleReleases,
  auth: {
    emailPasswordEnabled: authConfig.signIn?.email?.enabled === true,
    emailPasswordRequired: authConfig.signIn?.email?.passwordRequired === true,
    emailEnumerationProtection: projectConfig.emailPrivacyConfig?.enableImprovedEmailPrivacy === true,
    passwordPolicyEnforcement: projectConfig.passwordPolicyConfig?.enforcementState || 'OFF',
    providers: {
      google: providerStates['google.com'] === true,
      github: providerStates['github.com'] === true
    }
  }
};

if (!baseline.auth.providers.google || !baseline.auth.providers.github) {
  throw new Error('Google and GitHub must both be enabled in the production baseline.');
}
if (baseline.auth.emailPasswordEnabled) {
  throw new Error('Capture the production baseline before enabling Email/Password.');
}

if (!existsSync(MANIFEST_DIRECTORY)) mkdirSync(MANIFEST_DIRECTORY, { recursive: true });
const manifestPath = join(MANIFEST_DIRECTORY, `baseline-${timestamp}.json`);
writeFileSync(manifestPath, `${JSON.stringify(baseline, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  captured: true,
  manifestPath,
  hostingVersion: baseline.hosting.versionName,
  rulesReleases: baseline.rules.length,
  providers: baseline.auth.providers
}, null, 2));
