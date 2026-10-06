import { spawnSync } from 'node:child_process';

const STAGING_PROJECT = 'kanata-memorial-admin';
const PRODUCTION_PROJECT = 'kanata-memorial';
const projectIndex = process.argv.indexOf('--project');
const requestedProject = projectIndex >= 0 ? process.argv[projectIndex + 1] : STAGING_PROJECT;
const phaseIndex = process.argv.indexOf('--phase');
const phase = phaseIndex >= 0 ? process.argv[phaseIndex + 1] : 'backend';

if (!requestedProject || requestedProject === PRODUCTION_PROJECT || requestedProject !== STAGING_PROJECT || !['backend', 'release'].includes(phase)) {
  console.error(`Refusing preview deployment to ${requestedProject || 'an unspecified project'}.`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

run('npm', ['--prefix', 'functions', 'run', 'build']);
run('npm', ['run', 'build:hosting']);

if (phase === 'release') {
  run('node', ['scripts/verify-preview-public-delivery.mjs']);
}

run('firebase', [
  'deploy',
  '--only',
  phase === 'backend' ? 'functions,firestore:indexes' : 'firestore:rules,storage',
  '--project',
  STAGING_PROJECT,
  '--force',
  '--non-interactive'
]);

if (phase === 'release') run('firebase', [
  'hosting:channel:deploy',
  'admin-governance',
  '--project',
  STAGING_PROJECT,
  '--expires',
  '7d',
  '--non-interactive'
]);
