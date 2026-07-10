import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const productionBuild = process.argv.includes('--production');
const outputNames = productionBuild
  ? ['.hosting-public', '.hosting-admin', '.hosting-maintenance']
  : ['.hosting-preview'];
const excludedFileNames = new Set([
  'firebase-config.example.js',
  'firebase-config.js',
  'firebase-config.local.js',
]);
const forbiddenSegments = new Set([
  '.agents',
  '.codex',
  '.firebase',
  '.git',
  '.github',
  'functions',
  'node_modules',
  'scripts',
  'tests',
]);

function shouldCopy(source) {
  const relativePath = relative(repositoryRoot, source);
  const segments = relativePath.split(sep);
  if (segments.some((segment) => segment.startsWith('.') || forbiddenSegments.has(segment))) {
    return false;
  }
  return !excludedFileNames.has(basename(source));
}

function prepareOutput(name) {
  if (!outputNames.includes(name)) throw new Error(`Unexpected Hosting output: ${name}`);
  const output = join(repositoryRoot, name);
  if (dirname(output) !== repositoryRoot || basename(output) !== name) {
    throw new Error('Refusing to clean an unexpected Hosting output path.');
  }
  rmSync(output, { recursive: true, force: true });
  mkdirSync(output, { recursive: true });
  return output;
}

function copyRequired(output, sourcePath, destinationPath = sourcePath) {
  const source = join(repositoryRoot, sourcePath);
  if (!existsSync(source)) throw new Error(`Required Hosting source is missing: ${sourcePath}`);
  const destination = join(output, destinationPath);
  mkdirSync(dirname(destination), { recursive: true });
  cpSync(source, destination, { recursive: true, filter: shouldCopy });
}

function copyDirectoryContents(output, sourcePath) {
  const source = join(repositoryRoot, sourcePath);
  if (!existsSync(source)) throw new Error(`Required Hosting source is missing: ${sourcePath}`);
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (!shouldCopy(join(source, entry.name))) continue;
    copyRequired(output, join(sourcePath, entry.name), entry.name);
  }
}

function assertSafeOutput(output) {
  let fileCount = 0;
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(output, path);
      const segments = relativePath.split(sep);
      if (
        entry.name.startsWith('.') ||
        forbiddenSegments.has(entry.name) ||
        excludedFileNames.has(entry.name) ||
        /(^|\.)env($|\.)/i.test(entry.name) ||
        /(?:service.?account|client.?secret|private.?key)/i.test(entry.name)
      ) {
        throw new Error(`Refusing unsafe Hosting output: ${relativePath}`);
      }
      if (segments.some((segment) => forbiddenSegments.has(segment))) {
        throw new Error(`Refusing unsafe Hosting output path: ${relativePath}`);
      }
      if (entry.isDirectory()) inspect(path);
      else fileCount += 1;
    }
  }
  inspect(output);
  if (fileCount === 0) throw new Error(`Hosting output is empty: ${basename(output)}`);
  return fileCount;
}

function buildPreview() {
  const output = prepareOutput('.hosting-preview');
  for (const file of ['404.html', 'index-maintenance.html', 'index.html', 'shooting-star.png']) {
    copyRequired(output, file);
  }
  for (const directory of ['admin', 'assets', 'images']) copyRequired(output, directory);
  return { name: basename(output), files: assertSafeOutput(output) };
}

function buildPublic() {
  const output = prepareOutput('.hosting-public');
  for (const file of ['404.html', 'index.html', 'shooting-star.png']) copyRequired(output, file);
  for (const directory of ['assets', 'images']) copyRequired(output, directory);
  return { name: basename(output), files: assertSafeOutput(output) };
}

function buildAdmin() {
  const output = prepareOutput('.hosting-admin');
  copyDirectoryContents(output, 'admin');
  copyRequired(output, 'shooting-star.png');
  copyRequired(output, 'images/kanata-header.png');
  copyRequired(output, 'assets/js/firebase-init.js');
  return { name: basename(output), files: assertSafeOutput(output) };
}

function buildMaintenance() {
  const output = prepareOutput('.hosting-maintenance');
  copyRequired(output, 'index-maintenance.html', 'index.html');
  copyRequired(output, 'shooting-star.png');
  copyRequired(output, 'images/kanata-header.png');
  return { name: basename(output), files: assertSafeOutput(output) };
}

const results = productionBuild
  ? [buildPublic(), buildAdmin(), buildMaintenance()]
  : [buildPreview()];

for (const result of results) {
  console.log(`Prepared ${result.name} with ${result.files} allowlisted files.`);
}
