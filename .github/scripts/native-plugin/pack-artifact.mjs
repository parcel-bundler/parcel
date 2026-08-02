/**
 * Packs the shared library built for a single target into a publishable npm
 * tarball.
 *
 * Usage:
 *   node pack-artifact.mjs --dir <plugin dir> --target <rust triple>
 *                          --library <path to .so/.dylib/.dll> --out <dir>
 *
 * Nothing here is specific to the language the plugin is written in: whatever
 * produced the library, the artifact package is the same. Rust builds locate
 * their library with cargo-library.mjs first; Go builds already know the path,
 * since they chose it with `-o`.
 *
 * The tarball is written to <out>/<target>.tgz so later steps can find it
 * without having to reconstruct npm's naming scheme.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {npmPack, reportErrors} from './cli.mjs';
import {
  LIBRARY_BASENAME,
  artifactPackage,
  readPluginPackage,
  writeJson,
} from './plugin-package.mjs';
import {TARGETS} from './targets.mjs';

reportErrors();

let {values} = parseArgs({
  options: {
    dir: {type: 'string', default: '.'},
    target: {type: 'string'},
    library: {type: 'string'},
    out: {type: 'string'},
  },
});

for (let required of ['target', 'library', 'out']) {
  if (!values[required]) {
    throw new Error(`Missing required argument --${required}`);
  }
}

let target = values.target;
let info = TARGETS[target];
if (!info) {
  throw new Error(
    `Unsupported target ${target}. Supported targets: ${Object.keys(
      TARGETS,
    ).join(', ')}`,
  );
}

let {dir, pkg} = readPluginPackage(values.dir);
if (!Object.hasOwn(pkg.parcel.artifacts, target)) {
  throw new Error(
    `${pkg.name} does not declare an artifact package for ${target}`,
  );
}

let library = path.resolve(values.library);
if (!fs.existsSync(library)) {
  throw new Error(`No library at ${library}`);
}
if (!library.toLowerCase().endsWith(`.${info.ext}`)) {
  throw new Error(
    `${library} is not a .${info.ext}, which is what ${target} loads`,
  );
}

// Stage the package outside the repo so `npm pack` only ever sees the two files
// we put there.
let stage = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'parcel-plugin-'),
);

let libraryName = `${LIBRARY_BASENAME}.${info.ext}`;
fs.copyFileSync(library, path.join(stage, libraryName));

let artifact = artifactPackage(pkg, target);
writeJson(path.join(stage, 'package.json'), artifact);
console.log(`Generated package.json for ${artifact.name}:`);
console.log(JSON.stringify(artifact, null, 2));

let packed = npmPack(stage, stage);

let out = path.resolve(values.out);
fs.mkdirSync(out, {recursive: true});
// Named after the target rather than the package so later jobs can tell which
// tarball belongs to which target without parsing npm's naming scheme.
let tarball = path.join(out, `${target}.tgz`);
fs.copyFileSync(path.join(stage, packed.filename), tarball);

console.log(
  `Packed ${artifact.name}@${artifact.version} (${packed.size} bytes) to ${tarball}`,
);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
}
