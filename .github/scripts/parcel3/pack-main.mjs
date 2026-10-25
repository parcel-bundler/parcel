/**
 * Packs the packages users install: the launcher, plus a pinned
 * optionalDependency on every platform package the build produced.
 *
 * The same build is published under two names. `parcel` is Parcel 3 proper,
 * while `@parcel/parcel3` runs it as `parcel3`, so that it can be installed
 * beside Parcel 2 and tried out without replacing it. Both depend on the same
 * platform packages, so the binaries are published only once.
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

// Pinned to the exact version: a platform package only ever matches the Parcel
// build it was produced alongside.
let optionalDependencies = {};
for (let file of metadata) {
  let {name, version} = JSON.parse(
    fs.readFileSync(path.join(artifacts, file), 'utf8'),
  );
  if (version !== values.version) {
    throw new Error(
      `${name} was built as ${version}, but Parcel is being packed as ${values.version}`,
    );
  }
  optionalDependencies[name] = version;
}

const PACKAGES = [
  {name: 'parcel', bin: 'parcel'},
  {name: '@parcel/parcel3', bin: 'parcel3'},
];

let out = path.resolve(values.out);
fs.mkdirSync(out, {recursive: true});

for (let {name, bin} of PACKAGES) {
  let stage = fs.mkdtempSync(
    path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'parcel-main-'),
  );
  fs.mkdirSync(path.join(stage, 'bin'));
  // The launcher takes the command name from its own file name.
  fs.copyFileSync(
    path.join(import.meta.dirname, 'launcher.js'),
    path.join(stage, 'bin', bin),
  );
  fs.chmodSync(path.join(stage, 'bin', bin), 0o755);

  let pkg = {
    name,
    version: values.version,
    description: 'Blazing fast, zero configuration web application bundler',
    license: 'MIT',
    repository: {
      type: 'git',
      url: 'https://github.com/parcel-bundler/parcel.git',
    },
    bin: {[bin]: `bin/${bin}`},
    // The runtime modules bundled into user code (the ESM helpers, React Refresh,
    // ...) are embedded in the executable, so nothing else is needed.
    files: ['bin'],
    // The launcher uses process.execve where it can, added in Node 23.11, and
    // falls back to spawnSync everywhere else.
    engines: {node: '>= 18'},
    optionalDependencies,
  };

  writeJson(path.join(stage, 'package.json'), pkg);
  console.log(`Generated package.json for ${name}:`);
  console.log(JSON.stringify(pkg, null, 2));

  let packed = npmPack(stage, out);

  console.log(
    `Packed ${pkg.name}@${pkg.version} (${packed.size} bytes) with ${metadata.length} platform packages`,
  );
}
