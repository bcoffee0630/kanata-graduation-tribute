import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

const PROJECT = 'kanata-memorial';
const OWNER_FILE = '.production-owner.env';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

if (argument('--project') !== PROJECT || argument('--confirm-production') !== PROJECT ||
  argument('--confirm-owner-credential') !== 'prepare') {
  console.error('Refusing Owner preparation because the production confirmations do not match.');
  process.exit(1);
}

const release = requireProductionReleaseTag(argument('--release-tag'));

if (!existsSync(OWNER_FILE)) {
  throw new Error('The ignored production Owner identity file is missing.');
}
const ownerValues = Object.fromEntries(readFileSync(OWNER_FILE, 'utf8')
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#') && line.includes('='))
  .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]));
const ownerUid = ownerValues.PRODUCTION_OWNER_UID || '';
const ownerEmail = (ownerValues.PRODUCTION_OWNER_EMAIL || '').toLowerCase();
if (!ownerUid || !ownerEmail) throw new Error('The production Owner identity file is incomplete.');

const credential = applicationDefault();
initializeApp({ projectId: PROJECT, credential });
const auth = getAuth();
const user = await auth.getUser(ownerUid);

async function lookupOwner() {
  const accessToken = await credential.getAccessToken();
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:lookup`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken.access_token}`,
        'Content-Type': 'application/json',
        'X-Goog-User-Project': PROJECT
      },
      body: JSON.stringify({ localId: [ownerUid] })
    }
  );
  if (!response.ok) throw new Error(`Unable to verify Owner providers (${response.status}).`);
  const payload = await response.json();
  const account = payload.users?.[0];
  if (!account || account.localId !== ownerUid) throw new Error('Production Owner was not found.');
  return account;
}

if (user.email?.toLowerCase() !== ownerEmail || user.disabled) {
  throw new Error('Production Owner identity does not match the expected active account.');
}
const googleProvider = user.providerData.find((provider) => provider.providerId === 'google.com');
if (!googleProvider) {
  throw new Error('Production Owner must retain the existing Google provider.');
}
const ownerBefore = await lookupOwner();
if (
  Number(ownerBefore.passwordUpdatedAt || 0) > 0 ||
  ownerBefore.providerUserInfo?.some((provider) => provider.providerId === 'password')
) {
  throw new Error('The Owner already has a password credential; refusing to rotate it.');
}

const temporaryPassword = `Aa1!${randomBytes(32).toString('base64url')}`;
await auth.updateUser(ownerUid, { password: temporaryPassword });
await auth.revokeRefreshTokens(ownerUid);
let ownerAfter = await lookupOwner();
if (!ownerAfter.providerUserInfo?.some((provider) => provider.providerId === 'google.com')) {
  await auth.updateUser(ownerUid, {
    providerToLink: {
      providerId: 'google.com',
      uid: googleProvider.uid,
      ...(googleProvider.email ? { email: googleProvider.email } : {}),
      ...(googleProvider.displayName ? { displayName: googleProvider.displayName } : {}),
      ...(googleProvider.photoURL ? { photoURL: googleProvider.photoURL } : {})
    }
  });
  ownerAfter = await lookupOwner();
}
if (
  Number(ownerAfter.passwordUpdatedAt || 0) <= 0 ||
  !ownerAfter.providerUserInfo?.some((provider) => provider.providerId === 'google.com')
) {
  throw new Error('The Owner password and Google providers could not both be verified after preparation.');
}
console.log(JSON.stringify({
  passwordCredentialPrepared: true,
  temporaryPasswordDisclosed: false,
  releaseTag: release.releaseTag
}, null, 2));
