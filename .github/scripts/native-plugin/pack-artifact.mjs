/**
 * Packs the cdylib built for a single target into a publishable npm tarball.
 *
 * Usage:
 *   node pack-artifact.mjs --dir <plugin dir> --target <rust triple>
 *                          --cargo-messages <cargo json output> --out <dir>
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
    'cargo-messages': {type: 'string'},
    out: {type: 'string'},
  },
});

for (let required of ['target', 'cargo-messages', 'out']) {
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

/**
 * Finds the cdylib cargo just built by reading its JSON message stream, rather
 * than guessing at target/<triple>/release/lib<crate>.<ext>. Cargo already
 * knows the answer, including how the crate name was mangled and where the
 * target directory is.
 */
function findLibrary(messagesFile, pluginDir, ext) {
  let manifest = path.resolve(pluginDir, 'Cargo.toml');
  let matches = [];

  for (let line of fs.readFileSync(messagesFile, 'utf8').split('\n')) {
    if (!line.startsWith('{')) {
      continue;
    }

    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue;
    }

    if (
      message.reason !== 'compiler-artifact' ||
      !message.target?.kind?.includes('cdylib')
    ) {
      continue;
    }

    let files = (message.filenames ?? []).filter(file =>
      file.toLowerCase().endsWith(`.${ext}`),
    );
    if (files.length > 0) {
      matches.push({
        manifestPath: message.manifest_path,
        file: files[files.length - 1],
      });
    }
  }

  if (matches.length === 0) {
    throw new Error(
      `cargo did not produce a .${ext} for ${target}. Does the crate in ${pluginDir} set crate-type = ["cdylib"]?`,
    );
  }

  // A dependency may also be a cdylib, so prefer the plugin's own crate.
  let samePath = (a, b) =>
    process.platform === 'win32'
      ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase()
      : path.resolve(a) === path.resolve(b);
  let own = matches.filter(
    match => match.manifestPath && samePath(match.manifestPath, manifest),
  );
  if (own.length > 0) {
    return own[own.length - 1].file;
  }

  if (matches.length > 1) {
    throw new Error(
      `cargo produced multiple cdylibs and none belong to ${manifest}:\n${matches
        .map(m => `  - ${m.file}`)
        .join('\n')}`,
    );
  }

  return matches[0].file;
}

let library = findLibrary(values['cargo-messages'], dir, info.ext);
console.log(`Found ${library}`);

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
