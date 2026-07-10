import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { applicationDefault } from 'firebase-admin/app';

const PROJECT = 'kanata-memorial';
const PUBLIC_SITE = 'kanata-memorial';
const ADMIN_DOMAIN = 'admin.eienkanata.com';
const WEB_APP_NAME = 'Kanata Memorial Governance Admin';
const SITE_IDS = [
  'eienkanata-admin',
  'kanata-memorial-governance',
  'eienkanata-governance'
];
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
  console.error('Refusing production Hosting setup without explicit project confirmation and --apply.');
  process.exit(1);
}

const credential = applicationDefault();
const accessToken = await credential.getAccessToken();
const headers = {
  Authorization: `Bearer ${accessToken.access_token}`,
  'Content-Type': 'application/json',
  'X-Goog-User-Project': PROJECT
};

async function api(url, options = {}, acceptedStatuses = []) {
  const response = await fetch(url, { headers, ...options });
  if (!response.ok && !acceptedStatuses.includes(response.status)) {
    throw new Error(`Production Hosting setup request failed (${response.status}).`);
  }
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  return { response, payload };
}

async function pollOperation(root, operationName, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let operation = { name: operationName };
  while (operation.done !== true && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    ({ payload: operation } = await api(`${root}/${operationName}`));
  }
  if (operation.done !== true || operation.error) {
    throw new Error(`Firebase operation did not complete successfully: ${operationName}`);
  }
  return operation;
}

async function waitForResource(url, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { response, payload } = await api(url, {}, [404]);
    if (response.ok) return payload;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(`Firebase resource was not available within the expected time: ${url}`);
}

function hasRequiredDnsUpdates(value) {
  return value && typeof value === 'object' &&
    Array.isArray(value.desired) && value.desired.length > 0;
}

async function waitForDomainConfiguration(url, timeoutMs = 5 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { payload } = await api(url);
    const active = payload.hostState === 'HOST_ACTIVE' &&
      payload.ownershipState === 'OWNERSHIP_ACTIVE';
    if (active || hasRequiredDnsUpdates(payload.requiredDnsUpdates)) return payload;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Firebase did not provide the Admin custom-domain DNS configuration in time.');
}

const hostingRoot = 'https://firebasehosting.googleapis.com/v1beta1';
const firebaseRoot = 'https://firebase.googleapis.com/v1beta1';
let { payload: sitesPayload } = await api(`${hostingRoot}/projects/${PROJECT}/sites?pageSize=100`);
let sites = sitesPayload.sites || [];
const existingAdminSites = sites.filter((site) => SITE_IDS.includes(site.name?.split('/').at(-1)));
if (existingAdminSites.length > 1) {
  throw new Error('More than one approved Admin Hosting site already exists; refusing an ambiguous setup.');
}

let adminSite = existingAdminSites[0] || null;
if (!adminSite) {
  for (const siteId of SITE_IDS) {
    const { response, payload } = await api(
      `${hostingRoot}/projects/${PROJECT}/sites?siteId=${encodeURIComponent(siteId)}`,
      { method: 'POST', body: '{}' },
      [409]
    );
    if (response.ok) {
      adminSite = payload;
      break;
    }
  }
}
if (!adminSite?.name) throw new Error('None of the approved Admin Hosting Site IDs is available.');
const siteId = adminSite.name.split('/').at(-1);
adminSite = await waitForResource(`${hostingRoot}/projects/${PROJECT}/sites/${siteId}`);

let { payload: appsPayload } = await api(`${firebaseRoot}/projects/${PROJECT}/webApps?pageSize=100`);
let webApps = (appsPayload.apps || []).filter((app) => app.state !== 'DELETED');
const matchingApps = webApps.filter((app) => app.displayName === WEB_APP_NAME);
if (matchingApps.length > 1) {
  throw new Error('More than one production Admin Web App has the expected display name.');
}
let webApp = matchingApps[0] || null;
if (!webApp) {
  const { payload: createOperation } = await api(`${firebaseRoot}/projects/${PROJECT}/webApps`, {
    method: 'POST',
    body: JSON.stringify({ displayName: WEB_APP_NAME })
  });
  if (!createOperation.name) throw new Error('Firebase did not return a Web App creation operation.');
  await pollOperation(firebaseRoot, createOperation.name);
  ({ payload: appsPayload } = await api(`${firebaseRoot}/projects/${PROJECT}/webApps?pageSize=100`));
  webApps = (appsPayload.apps || []).filter((app) => app.state !== 'DELETED');
  webApp = webApps.find((app) => app.displayName === WEB_APP_NAME) || null;
}
if (!webApp?.appId) throw new Error('The production Admin Web App could not be identified.');

if (adminSite.appId && adminSite.appId !== webApp.appId) {
  throw new Error('The selected Admin Hosting site is already linked to a different Web App.');
}
if (adminSite.appId !== webApp.appId) {
  ({ payload: adminSite } = await api(
    `${hostingRoot}/projects/${PROJECT}/sites/${siteId}?updateMask=appId`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name: `projects/${PROJECT}/sites/${siteId}`, appId: webApp.appId })
    }
  ));
}
if (adminSite.appId !== webApp.appId) throw new Error('Admin Hosting site/Web App linking failed.');

for (const site of sites) {
  const existingDomains = await api(`${hostingRoot}/${site.name}/customDomains?pageSize=100`);
  const domain = (existingDomains.payload.customDomains || []).find(
    (item) => item.name?.endsWith(`/customDomains/${ADMIN_DOMAIN}`)
  );
  if (domain && site.name !== adminSite.name) {
    throw new Error('The Admin custom domain is already linked to a different Hosting site.');
  }
}

let { payload: domainsPayload } = await api(`${hostingRoot}/${adminSite.name}/customDomains?pageSize=100`);
let customDomain = (domainsPayload.customDomains || []).find(
  (item) => item.name?.endsWith(`/customDomains/${ADMIN_DOMAIN}`)
) || null;
let customDomainOperation = '';
if (!customDomain) {
  const { payload: domainOperation } = await api(
    `${hostingRoot}/${adminSite.name}/customDomains?customDomainId=${encodeURIComponent(ADMIN_DOMAIN)}`,
    { method: 'POST', body: '{}' }
  );
  if (!domainOperation.name) throw new Error('Firebase did not return a custom-domain operation.');
  customDomainOperation = domainOperation.name;
  await waitForResource(
    `${hostingRoot}/${adminSite.name}/customDomains/${ADMIN_DOMAIN}`,
    60 * 1000
  );
}
customDomain = await waitForDomainConfiguration(
  `${hostingRoot}/${adminSite.name}/customDomains/${ADMIN_DOMAIN}`
);
if (!customDomain?.name) throw new Error('The Admin custom domain could not be identified.');

function runFirebase(args) {
  const result = spawnSync('firebase', args, { stdio: 'inherit' });
  if (result.status !== 0) throw new Error(`Firebase CLI failed: firebase ${args.join(' ')}`);
}
runFirebase(['target:apply', 'hosting', 'public', PUBLIC_SITE, '--project', PROJECT]);
runFirebase(['target:apply', 'hosting', 'admin', siteId, '--project', PROJECT]);

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const manifest = {
  projectId: PROJECT,
  adminSiteId: siteId,
  adminWebAppId: webApp.appId,
  adminDomain: ADMIN_DOMAIN,
  customDomainOperation,
  hostState: customDomain.hostState || 'HOST_UNSPECIFIED',
  ownershipState: customDomain.ownershipState || 'OWNERSHIP_STATE_UNSPECIFIED',
  requiredDnsUpdates: customDomain.requiredDnsUpdates || {},
  capturedAt: new Date().toISOString()
};
if (!existsSync(MANIFEST_DIRECTORY)) mkdirSync(MANIFEST_DIRECTORY, { recursive: true });
const manifestPath = join(MANIFEST_DIRECTORY, `hosting-setup-${timestamp}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
