/**
 * Packs the plugin's own package, with a pinned optionalDependency on every
 * artifact package so npm installs the right binary for the host platform.
 *
 * Usage:
 *   node pack-main.mjs --dir <plugin dir> --artifacts <dir of *.tgz> --out <dir>
 *
 * Refuses to pack unless every declared target produced a tarball, so a partial
 * matrix can never publish a plugin that claims support it does not have.
 */
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {npmPack, reportErrors} from './cli.mjs';
import {readPluginPackage, writeJson} from './plugin-package.mjs';

reportErrors();

let {values} = parseArgs({
  options: {
    dir: {type: 'string', default: '.'},
    artifacts: {type: 'string'},
    out: {type: 'string'},
  },
});

for (let required of ['artifacts', 'out']) {
  if (!values[required]) {
    throw new Error(`Missing required argument --${required}`);
  }
}

let {file, dir, pkg, targets} = readPluginPackage(values.dir);

let missing = targets.filter(
  target => !fs.existsSync(path.join(values.artifacts, `${target}.tgz`)),
);
if (missing.length > 0) {
  throw new Error(
    `Missing built artifacts for ${missing.length} of ${
      targets.length
    } target(s):\n${missing.map(t => `  - ${t}`).join('\n')}`,
  );
}

// Pinned to the exact version: an artifact package is only ever compatible with
// the plugin build it was produced from.
let optionalDependencies = {...pkg.optionalDependencies};
for (let target of targets) {
  optionalDependencies[pkg.parcel.artifacts[target]] = pkg.version;
}

// parcel.devLibrary points at a build inside the author's working tree, so it is
// meaningless to a consumer. Dropping it here is also what lets Parcel treat the
// key as authoritative when it *is* present: it can only be present in a checkout.
let parcel = {...pkg.parcel};
let devLibrary = parcel.devLibrary;
delete parcel.devLibrary;

let original = fs.readFileSync(file, 'utf8');
let out = path.resolve(values.out);
fs.mkdirSync(out, {recursive: true});

let packed;
try {
  writeJson(file, {...pkg, parcel, optionalDependencies});
  console.log('Added optionalDependencies:');
  console.log(JSON.stringify(optionalDependencies, null, 2));
  if (devLibrary != null) {
    console.log(
      `Dropped parcel.devLibrary (${devLibrary}) from the published package`,
    );
  }

  packed = npmPack(dir, out);
} finally {
  // The edit is only meant to reach the tarball, never the checkout.
  fs.writeFileSync(file, original);
}

let tarball = path.join(out, packed.filename);
console.log(
  `Packed ${pkg.name}@${pkg.version} (${packed.size} bytes) to ${tarball}`,
);

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tarball=${tarball}\n`);
}
