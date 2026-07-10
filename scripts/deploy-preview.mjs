import { spawnSync } from 'node:child_process';

const STAGING_PROJECT = 'kanata-memorial-admin';
const PRODUCTION_PROJECT = 'kanata-memorial';
const projectIndex = process.argv.indexOf('--project');
const requestedProject = projectIndex >= 0 ? process.argv[projectIndex + 1] : STAGING_PROJECT;

if (!requestedProject || requestedProject === PRODUCTION_PROJECT || requestedProject !== STAGING_PROJECT) {
  console.error(`Refusing preview deployment to ${requestedProject || 'an unspecified project'}.`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}

run('npm', ['--prefix', 'functions', 'run', 'build']);
run('npm', ['run', 'build:hosting']);

run('firebase', [
  'deploy',
  '--only',
  'functions,firestore:rules,firestore:indexes,storage',
  '--project',
  STAGING_PROJECT,
  '--force',
  '--non-interactive'
]);

run('firebase', [
  'hosting:channel:deploy',
  'admin-governance',
  '--project',
  STAGING_PROJECT,
  '--expires',
  '7d',
  '--non-interactive'
]);
