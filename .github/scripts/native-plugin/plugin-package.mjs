import fs from 'node:fs';
import path from 'node:path';

import {TARGETS} from './targets.mjs';

/** The cdylib is renamed to this inside every artifact package, so a plugin's
 * metadata does not depend on what the crate happens to be called. */
export const LIBRARY_BASENAME = 'plugin';

/**
 * Fields that describe the wrapper package's own JavaScript, dependencies, or
 * repository layout. An artifact package contains a single cdylib and nothing
 * else, so inheriting these would at best be noise and at worst break install
 * (`private`) or publish (`scripts`).
 */
const DROPPED_FIELDS = [
  'bin',
  'browser',
  'bundleDependencies',
  'bundledDependencies',
  'dependencies',
  'devDependencies',
  'directories',
  'exports',
  'imports',
  'main',
  'man',
  'module',
  'optionalDependencies',
  'peerDependencies',
  'peerDependenciesMeta',
  'private',
  'scripts',
  'sideEffects',
  'type',
  'types',
  'typings',
  'workspaces',
];

/**
 * Reads and validates the plugin's package.json. Every problem is reported at
 * once so a plugin author fixes their manifest in one pass rather than one
 * failed CI run per typo.
 */
export function readPluginPackage(dir) {
  let file = path.join(dir, 'package.json');
  let pkg;
  try {
    pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not read ${file}: ${err.message}`);
  }

  let errors = [];
  if (typeof pkg.name !== 'string' || pkg.name === '') {
    errors.push('"name" must be a non-empty string');
  }
  if (typeof pkg.version !== 'string' || pkg.version === '') {
    errors.push('"version" must be a non-empty string');
  }

  let parcel = pkg.parcel;
  if (parcel == null || typeof parcel !== 'object' || Array.isArray(parcel)) {
    errors.push('"parcel" must be an object');
  } else {
    if (!Number.isInteger(parcel.abi)) {
      errors.push('"parcel.abi" must be an integer');
    }

    let artifacts = parcel.artifacts;
    if (
      artifacts == null ||
      typeof artifacts !== 'object' ||
      Array.isArray(artifacts)
    ) {
      errors.push(
        '"parcel.artifacts" must be an object mapping Rust target triples to package names',
      );
    } else if (Object.keys(artifacts).length === 0) {
      errors.push('"parcel.artifacts" must contain at least one target');
    } else {
      let seen = new Map();
      for (let [target, name] of Object.entries(artifacts)) {
        if (!Object.hasOwn(TARGETS, target)) {
          errors.push(
            `"parcel.artifacts" has unsupported target ${JSON.stringify(
              target,
            )}. Supported targets: ${Object.keys(TARGETS).join(', ')}`,
          );
          continue;
        }
        if (typeof name !== 'string' || name === '') {
          errors.push(
            `"parcel.artifacts.${target}" must be a non-empty package name`,
          );
          continue;
        }
        if (seen.has(name)) {
          errors.push(
            `"parcel.artifacts" maps both ${seen.get(
              name,
            )} and ${target} to the package ${name}`,
          );
        }
        seen.set(name, target);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Invalid plugin package.json at ${file}:\n${errors
        .map(e => `  - ${e}`)
        .join('\n')}`,
    );
  }

  return {dir, file, pkg, targets: Object.keys(pkg.parcel.artifacts)};
}

/**
 * Derives the package.json of the artifact package for a single target from the
 * plugin's package.json: same metadata, platform-specific name, and just enough
 * `parcel` metadata for Parcel to load the library.
 */
export function artifactPackage(pkg, target) {
  let info = TARGETS[target];
  let library = `${LIBRARY_BASENAME}.${info.ext}`;

  // Spreading first preserves the source key order, so the generated file reads
  // like the one the author wrote.
  let artifact = {...pkg};
  for (let field of [...DROPPED_FIELDS, 'parcel']) {
    delete artifact[field];
  }

  artifact.name = pkg.parcel.artifacts[target];
  artifact.os = [info.os];
  artifact.cpu = [info.cpu];
  if (info.libc) {
    artifact.libc = [info.libc];
  } else {
    delete artifact.libc;
  }
  artifact.files = [library];
  artifact.parcel = {abi: pkg.parcel.abi, library};

  return artifact;
}

export function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}
