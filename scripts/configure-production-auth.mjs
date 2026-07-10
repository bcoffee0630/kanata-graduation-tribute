import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

const PROJECT = 'kanata-memorial';
const ADMIN_DOMAIN = 'admin.eienkanata.com';
const ALLOWED_SITE_IDS = new Set([
  'eienkanata-admin',
  'kanata-memorial-governance',
  'eienkanata-governance'
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || '') : '';
}

const project = argument('--project');
const confirmation = argument('--confirm-production');
const siteId = argument('--admin-hosting-site');
const previewDomain = argument('--admin-preview-domain');
const apply = process.argv.includes('--apply');

if (project !== PROJECT || confirmation !== PROJECT || !ALLOWED_SITE_IDS.has(siteId)) {
  console.error(
    'Refusing Auth configuration. Required: --project kanata-memorial ' +
    '--confirm-production kanata-memorial --admin-hosting-site <approved-site-id>.'
  );
  process.exit(1);
}

const validPreviewDomain = previewDomain.startsWith(`${siteId}--`) &&
  previewDomain.endsWith('.web.app') &&
  /^[a-z0-9.-]+$/.test(previewDomain);
if (apply && !validPreviewDomain) {
  console.error(
    'Refusing Auth apply without the exact Admin Hosting preview domain from the deployed channel.'
  );
  process.exit(1);
}
const release = apply ? requireProductionReleaseTag(argument('--release-tag')) : null;

const credential = applicationDefault();
const app = initializeApp({ projectId: PROJECT, credential });
const auth = getAuth(app);
const accessToken = await credential.getAccessToken();
const apiRoot = `https://identitytoolkit.googleapis.com/admin/v2/projects/${PROJECT}`;
const headers = {
  Authorization: `Bearer ${accessToken.access_token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': PROJECT
};

async function api(path, options = {}) {
  const response = await fetch(`${apiRoot}${path}`, { headers, ...options });
  if (!response.ok) {
    throw new Error(`Identity Toolkit request failed (${response.status}).`);
  }
  return response.json();
}

function providerStates(payload) {
  return Object.fromEntries((payload.defaultSupportedIdpConfigs || []).map((provider) => [
    String(provider.name || '').split('/').at(-1),
    provider.enabled === true
  ]));
}

const [config, providersBefore] = await Promise.all([
  api('/config'),
  api('/defaultSupportedIdpConfigs?pageSize=100')
]);
const providerStateBefore = providerStates(providersBefore);
if (providerStateBefore['google.com'] !== true || providerStateBefore['github.com'] !== true) {
  throw new Error('Google and GitHub providers must both remain enabled before Auth configuration.');
}

const desiredDomains = [...new Set([
  ...(Array.isArray(config.authorizedDomains) ? config.authorizedDomains : []),
  ADMIN_DOMAIN,
  `${siteId}.web.app`,
  `${siteId}.firebaseapp.com`,
  ...(validPreviewDomain ? [previewDomain] : [])
])].sort();

let finalConfig = config;
let finalProjectConfig = null;

if (apply) {
  await api('/config?updateMask=signIn.email,authorizedDomains', {
    method: 'PATCH',
    body: JSON.stringify({
      signIn: { email: { enabled: true, passwordRequired: true } },
      authorizedDomains: desiredDomains
    })
  });
  await auth.projectConfigManager().updateProjectConfig({
    passwordPolicyConfig: {
      enforcementState: 'ENFORCE',
      forceUpgradeOnSignin: false,
      constraints: {
        minLength: 12,
        maxLength: 128,
        requireUppercase: true,
        requireLowercase: true,
        requireNumeric: true,
        requireNonAlphanumeric: true
      }
    },
    emailPrivacyConfig: { enableImprovedEmailPrivacy: true }
  });

  const [configAfter, projectConfigAfter, providersPayloadAfter] = await Promise.all([
    api('/config'),
    auth.projectConfigManager().getProjectConfig(),
    api('/defaultSupportedIdpConfigs?pageSize=100')
  ]);
  finalConfig = configAfter;
  finalProjectConfig = projectConfigAfter;
  const providersAfter = providerStates(providersPayloadAfter);
  if (
    providersAfter['google.com'] !== providerStateBefore['google.com'] ||
    providersAfter['github.com'] !== providerStateBefore['github.com']
  ) {
    throw new Error('An existing OAuth provider changed during Auth configuration.');
  }
  if (
    configAfter.signIn?.email?.enabled !== true ||
    configAfter.signIn?.email?.passwordRequired !== true ||
    !desiredDomains.every((domain) => configAfter.authorizedDomains?.includes(domain))
  ) {
    throw new Error('Email/password or authorized-domain verification failed after Auth configuration.');
  }
  const constraints = projectConfigAfter.passwordPolicyConfig?.constraints;
  if (
    projectConfigAfter.passwordPolicyConfig?.enforcementState !== 'ENFORCE' ||
    constraints?.minLength !== 12 ||
    constraints?.maxLength !== 128 ||
    constraints?.requireUppercase !== true ||
    constraints?.requireLowercase !== true ||
    constraints?.requireNumeric !== true ||
    constraints?.requireNonAlphanumeric !== true ||
    projectConfigAfter.emailPrivacyConfig?.enableImprovedEmailPrivacy !== true
  ) {
    throw new Error('Password policy or email privacy verification failed after Auth configuration.');
  }
}

console.log(JSON.stringify({
  projectId: PROJECT,
  mode: apply ? 'apply' : 'dry-run',
  emailPasswordEnabled: finalConfig.signIn?.email?.enabled === true,
  passwordRequired: finalConfig.signIn?.email?.passwordRequired === true,
  passwordPolicy: finalProjectConfig?.passwordPolicyConfig?.enforcementState || 'unchanged',
  emailEnumerationProtection: finalProjectConfig
    ? finalProjectConfig.emailPrivacyConfig?.enableImprovedEmailPrivacy === true
    : config.emailPrivacyConfig?.enableImprovedEmailPrivacy === true,
  authorizedDomains: desiredDomains,
  preservedProviders: {
    google: providerStateBefore['google.com'],
    github: providerStateBefore['github.com']
  },
  releaseTag: release?.releaseTag || null
}, null, 2));
