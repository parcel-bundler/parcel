/**
 * Packs the `parcel3` package itself: the launcher, plus a pinned
 * optionalDependency on every platform package the build produced.
 *
 * Usage:
 *   node pack-main.mjs --version 3.0.0 --artifacts <dir of *.tgz and *.json>
 *                      --out <dir>
 *
 * The platform packages are discovered from the metadata pack-platform.mjs wrote
 * beside each tarball, so the target list lives in the workflow matrix and
 * nowhere else. The build job succeeding for every target is what guarantees the
 * set is complete - `needs: build` blocks this job otherwise.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {npmPack, reportErrors} from '../native-plugin/cli.mjs';
import {writeJson} from './util.mjs';

reportErrors();

let {values} = parseArgs({
  options: {
    version: {type: 'string'},
    artifacts: {type: 'string'},
    out: {type: 'string'},
  },
});

for (let required of ['version', 'artifacts', 'out']) {
  if (!values[required]) {
    throw new Error(`Missing required argument --${required}`);
  }
}

let artifacts = path.resolve(values.artifacts);
let metadata = fs
  .readdirSync(artifacts)
  .filter(file => file.endsWith('.json'))
  .sort();
if (metadata.length === 0) {
  throw new Error(`No platform packages found in ${artifacts}`);
}

// Pinned to the exact version: a platform package only ever matches the parcel3
// build it was produced alongside.
let optionalDependencies = {};
for (let file of metadata) {
  let {name, version} = JSON.parse(
    fs.readFileSync(path.join(artifacts, file), 'utf8'),
  );
  if (version !== values.version) {
    throw new Error(
      `${name} was built as ${version}, but parcel3 is being packed as ${values.version}`,
    );
  }
  optionalDependencies[name] = version;
}

let stage = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'parcel3-main-'),
);
fs.mkdirSync(path.join(stage, 'bin'));
fs.copyFileSync(
  path.join(import.meta.dirname, 'launcher.js'),
  path.join(stage, 'bin', 'parcel3'),
);
fs.chmodSync(path.join(stage, 'bin', 'parcel3'), 0o755);

let pkg = {
  name: '@parcel/parcel3',
  version: values.version,
  description: 'Blazing fast, zero configuration web application bundler',
  license: 'MIT',
  repository: {
    type: 'git',
    url: 'https://github.com/parcel-bundler/parcel.git',
  },
  bin: {parcel3: 'bin/parcel3'},
  files: ['bin'],
  // The launcher uses process.execve where it can, added in Node 23.11, and
  // falls back to spawnSync everywhere else.
  engines: {node: '>= 18'},
  optionalDependencies,
};

writeJson(path.join(stage, 'package.json'), pkg);
console.log('Generated package.json for parcel3:');
console.log(JSON.stringify(pkg, null, 2));

let out = path.resolve(values.out);
fs.mkdirSync(out, {recursive: true});
let packed = npmPack(stage, out);

console.log(
  `Packed ${pkg.name}@${pkg.version} (${packed.size} bytes) with ${metadata.length} platform packages`,
);
