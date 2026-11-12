#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const runtimeVersion = packageJson.devEngines?.runtime?.version
  ?? packageJson.engines?.runtime?.version;
if (!runtimeVersion) {
  throw new Error('The package manifest does not declare a Node runtime version');
}

const lockfilePath = 'pnpm-lock.yaml';
const lines = fs.readFileSync(lockfilePath, 'utf8').split('\n');
const runtimePackage = `node@runtime:${runtimeVersion}`;

function indentation(line) {
  return line.length - line.trimStart().length;
}

function blockEnd(start, level) {
  let end = start + 1;
  while (end < lines.length) {
    if (lines[end].trim() !== '' && indentation(lines[end]) <= level) {
      break;
    }
    end += 1;
  }
  return end;
}

function removeRange(start, end) {
  lines.splice(start, end - start);
}

let importerRemoved = false;
for (let section = 0; section < lines.length; section += 1) {
  if (lines[section] !== 'importers:') {
    continue;
  }

  const sectionLimit = blockEnd(section, 0);
  const rootImporter = lines.findIndex(
    (line, index) => index > section && index < sectionLimit && line === '  .:',
  );
  if (rootImporter === -1) {
    continue;
  }

  const importerLimit = blockEnd(rootImporter, 2);
  const dependencies = lines.findIndex(
    (line, index) => index > rootImporter && index < importerLimit
      && line === '    dependencies:',
  );
  if (dependencies === -1) {
    continue;
  }

  const dependenciesLimit = blockEnd(dependencies, 4);
  const nodeDependency = lines.findIndex(
    (line, index) => index > dependencies && index < dependenciesLimit
      && line === '      node:',
  );
  if (nodeDependency === -1) {
    continue;
  }

  const hasOtherDependencies = lines.slice(dependencies + 1, dependenciesLimit)
    .some(line => line.trim() !== '' && indentation(line) === 6 && line !== '      node:');
  if (hasOtherDependencies) {
    removeRange(nodeDependency, blockEnd(nodeDependency, 6));
  } else {
    removeRange(dependencies, dependenciesLimit);
  }
  importerRemoved = true;
  break;
}

if (!importerRemoved) {
  throw new Error(`Could not find the root Node runtime dependency in ${lockfilePath}`);
}

let packageEntriesRemoved = 0;
for (let section = 0; section < lines.length; section += 1) {
  if (lines[section] !== 'packages:' && lines[section] !== 'snapshots:') {
    continue;
  }

  const sectionLimit = blockEnd(section, 0);
  const runtimeEntry = lines.findIndex(
    (line, index) => index > section && index < sectionLimit
      && (line === `  ${runtimePackage}:` || line === `  ${runtimePackage}: {}`),
  );
  if (runtimeEntry !== -1) {
    removeRange(runtimeEntry, blockEnd(runtimeEntry, 2));
    packageEntriesRemoved += 1;
  }
}

if (packageEntriesRemoved !== 2) {
  throw new Error(
    `Expected 2 Node runtime lock entries, removed ${packageEntriesRemoved}`,
  );
}

fs.writeFileSync(lockfilePath, `${lines.join('\n')}`);
