import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { resolveCname, resolveTxt } from 'node:dns/promises';
import { applicationDefault } from 'firebase-admin/app';

const PROJECT = 'kanata-memorial';
const ADMIN_DOMAIN = 'admin.eienkanata.com';
const MAIL_DOMAIN = 'auth.eienkanata.com';
const MAIL_DNS_FILE = '.production-mail-dns.json';
const MANIFEST_DIRECTORY = '.production-backups';
const SITE_IDS = new Set([
  'eienkanata-admin',
  'kanata-memorial-governance',
  'eienkanata-governance'
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] || '') : '';
}

const siteId = argument('--admin-hosting-site');
if (
  argument('--project') !== PROJECT ||
  argument('--confirm-production') !== PROJECT ||
  !SITE_IDS.has(siteId) ||
  !process.argv.includes('--verify')
) {
  console.error('Refusing production domain verification without exact project and Hosting site confirmation.');
  process.exit(1);
}
if (!existsSync(MAIL_DNS_FILE)) {
  throw new Error(`Create the ignored ${MAIL_DNS_FILE} from Firebase Auth Template DNS records.`);
}

const expected = JSON.parse(readFileSync(MAIL_DNS_FILE, 'utf8'));
const records = Array.isArray(expected.records) ? expected.records : [];
if (!records.length) throw new Error('The expected Firebase Auth mail DNS record list is empty.');

function normalizeDomain(value) {
  return String(value || '').trim().toLowerCase().replace(/\.$/, '');
}

function normalizeRdata(value) {
  const normalized = String(value || '').trim();
  return normalized.startsWith('"') && normalized.endsWith('"')
    ? normalized.slice(1, -1)
    : normalized.replace(/\.$/, '');
}

for (const record of records) {
  record.name = normalizeDomain(record.name);
  record.type = String(record.type || '').toUpperCase();
  record.value = normalizeRdata(record.value);
  const isMailDomain = record.name === MAIL_DOMAIN || record.name.endsWith(`.${MAIL_DOMAIN}`);
  if (
    !isMailDomain ||
    !['TXT', 'CNAME'].includes(record.type) ||
    !record.value
  ) {
    throw new Error('Mail DNS expectations must contain complete TXT/CNAME records under auth.eienkanata.com.');
  }
}
if (!records.some((record) =>
  record.name === MAIL_DOMAIN && record.type === 'TXT' && /^v=spf1\b/i.test(record.value)
)) {
  throw new Error('The expected mail DNS records do not include the Firebase SPF record.');
}
if (!records.some((record) =>
  record.type === 'CNAME' && record.name.includes('._domainkey.')
)) {
  throw new Error('The expected mail DNS records do not include a Firebase DKIM CNAME.');
}

const verifiedRecords = [];
for (const record of records) {
  const values = record.type === 'TXT'
    ? (await resolveTxt(record.name)).map((chunks) => chunks.join(''))
    : await resolveCname(record.name);
  const found = values.some((value) =>
    normalizeRdata(value).toLowerCase() === record.value.toLowerCase()
  );
  if (!found) throw new Error(`Required ${record.type} record is not published: ${record.name}.`);
  verifiedRecords.push({ name: record.name, type: record.type });
}

const dmarcValues = (await resolveTxt(`_dmarc.${MAIL_DOMAIN}`)).map((chunks) => chunks.join(''));
if (!dmarcValues.some((value) => /^v=dmarc1\s*;\s*p=none(?:\s*;|$)/i.test(value))) {
  throw new Error('The required p=none DMARC record is not published.');
}

const credential = applicationDefault();
const accessToken = await credential.getAccessToken();
const hostingResponse = await fetch(
  `https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT}/sites/${siteId}/` +
  `customDomains/${ADMIN_DOMAIN}`,
  {
    headers: {
      Authorization: `Bearer ${accessToken.access_token}`,
      'X-Goog-User-Project': PROJECT
    }
  }
);
if (!hostingResponse.ok) {
  throw new Error(`Unable to verify the Admin custom domain (${hostingResponse.status}).`);
}
const customDomain = await hostingResponse.json();
if (
  customDomain.hostState !== 'HOST_ACTIVE' ||
  customDomain.ownershipState !== 'OWNERSHIP_ACTIVE' ||
  !['CERT_ACTIVE', 'CERT_EXPIRING_SOON'].includes(customDomain.cert?.state) ||
  customDomain.reconciling === true
) {
  throw new Error('The Admin custom domain, ownership, or SSL certificate is not fully active.');
}

const httpsResponse = await fetch(`https://${ADMIN_DOMAIN}/`, { redirect: 'manual' });
if (httpsResponse.status >= 500) {
  throw new Error(`Admin HTTPS endpoint returned ${httpsResponse.status}.`);
}

const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
const manifest = {
  projectId: PROJECT,
  verifiedAt: new Date().toISOString(),
  adminDomain: {
    hostname: ADMIN_DOMAIN,
    hostState: customDomain.hostState,
    ownershipState: customDomain.ownershipState,
    certificateState: customDomain.cert.state,
    httpsStatus: httpsResponse.status
  },
  mailDomain: {
    hostname: MAIL_DOMAIN,
    verifiedRecords,
    dmarc: 'p=none'
  }
};
if (!existsSync(MANIFEST_DIRECTORY)) mkdirSync(MANIFEST_DIRECTORY, { recursive: true });
const manifestPath = join(MANIFEST_DIRECTORY, `domain-verification-${timestamp}.json`);
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({ ...manifest, manifestPath }, null, 2));
