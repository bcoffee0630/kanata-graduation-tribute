import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { requireProductionReleaseTag } from './production-release-guard.mjs';

const PRODUCTION_PROJECT = 'kanata-memorial';
const PRODUCTION_ENV = 'functions/.env.kanata-memorial';
const PRODUCTION_OWNER_FILE = '.production-owner.env';
const phases = new Set([
  'backend',
  'admin-preview',
  'maintenance',
  'governance',
  'bootstrap-lock',
  'release'
]);

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

const project = argument('--project');
const confirmation = argument('--confirm-production');
const phase = argument('--phase');
const releaseTag = argument('--release-tag');
const allowOwnerBootstrap = process.argv.includes('--allow-owner-bootstrap');

if (
  project !== PRODUCTION_PROJECT ||
  confirmation !== PRODUCTION_PROJECT ||
  !phases.has(phase) ||
  !releaseTag
) {
  console.error(
    'Refusing production deployment. Required: --project kanata-memorial ' +
    '--confirm-production kanata-memorial ' +
    '--phase <backend|admin-preview|maintenance|governance|bootstrap-lock|release> ' +
    '--release-tag <annotated-release-tag>.'
  );
  process.exit(1);
}

function configuredBootstrapUid() {
  if (!existsSync(PRODUCTION_ENV)) return '';
  const line = readFileSync(PRODUCTION_ENV, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith('BOOTSTRAP_OWNER_UID='));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

function configuredOwnerUid() {
  if (!existsSync(PRODUCTION_OWNER_FILE)) return '';
  const line = readFileSync(PRODUCTION_OWNER_FILE, 'utf8')
    .split(/\r?\n/)
    .find((entry) => entry.trim().startsWith('PRODUCTION_OWNER_UID='));
  return line ? line.slice(line.indexOf('=') + 1).trim() : '';
}

const bootstrapUid = configuredBootstrapUid();
if (phase === 'backend') {
  if (
    (allowOwnerBootstrap && (
      !configuredOwnerUid() || bootstrapUid !== configuredOwnerUid()
    )) ||
    (!allowOwnerBootstrap && bootstrapUid !== '')
  ) {
    console.error('Refusing backend deployment because the production Owner bootstrap guard failed.');
    process.exit(1);
  }
}
if (phase === 'bootstrap-lock' && bootstrapUid !== '') {
  console.error('Refusing bootstrap lock deployment until BOOTSTRAP_OWNER_UID is empty.');
  process.exit(1);
}

function configuredHostingTargets() {
  if (!existsSync('.firebaserc')) return null;
  try {
    const config = JSON.parse(readFileSync('.firebaserc', 'utf8'));
    return config.targets?.[PRODUCTION_PROJECT]?.hosting || null;
  } catch {
    return null;
  }
}

const hostingTargets = configuredHostingTargets();
const adminSites = new Set([
  'eienkanata-admin',
  'kanata-memorial-governance',
  'eienkanata-governance'
]);
if (
  !hostingTargets ||
  hostingTargets.public?.length !== 1 ||
  hostingTargets.public[0] !== PRODUCTION_PROJECT ||
  hostingTargets.admin?.length !== 1 ||
  !adminSites.has(hostingTargets.admin[0])
) {
  console.error('Refusing production deployment until both Hosting targets are explicitly configured.');
  process.exit(1);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) process.exit(result.status || 1);
  return result;
}

requireProductionReleaseTag(releaseTag);

run('npm', ['run', 'build']);
run('npm', ['run', 'build:hosting:production']);

const common = ['--project', PRODUCTION_PROJECT, '--non-interactive'];

if (phase === 'backend') {
  run('firebase', [
    'deploy', '--only', 'functions,firestore:indexes', '--config', 'firebase.production.json',
    ...common, '--force'
  ]);
} else if (phase === 'admin-preview') {
  run('firebase', [
    'hosting:channel:deploy', 'admin-governance', '--only', 'admin',
    '--config', 'firebase.production.json', ...common, '--expires', '7d'
  ]);
} else if (phase === 'maintenance') {
  run('node', [
    'scripts/set-production-maintenance.mjs', '--project', PRODUCTION_PROJECT,
    '--confirm-production', PRODUCTION_PROJECT, '--state', 'enabled',
    '--confirm-maintenance-state', 'enabled'
  ]);
  run('firebase', [
    'deploy', '--only', 'hosting:public,firestore:rules,storage',
    '--config', 'firebase.maintenance.json', ...common
  ]);
} else if (phase === 'governance') {
  run('firebase', [
    'deploy', '--only', 'firestore:rules,storage,hosting:admin',
    '--config', 'firebase.production.json', ...common
  ]);
} else if (phase === 'release') {
  run('firebase', [
    'deploy', '--only', 'hosting:public',
    '--config', 'firebase.production.json', ...common
  ]);
  run('node', [
    'scripts/set-production-maintenance.mjs', '--project', PRODUCTION_PROJECT,
    '--confirm-production', PRODUCTION_PROJECT, '--state', 'disabled',
    '--confirm-maintenance-state', 'disabled'
  ]);
} else {
  run('firebase', [
    'deploy', '--only', 'functions:bootstrapOwner', '--config', 'firebase.production.json',
    ...common, '--force'
  ]);
}
