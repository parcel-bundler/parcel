/**
 * Packs the parcel3 binary built for one target into a publishable npm tarball.
 *
 * Usage:
 *   node pack-platform.mjs --package parcel3-darwin-arm64 --version 3.0.0
 *                          --binary <path to the built executable>
 *                          --os darwin --cpu arm64 [--libc glibc]
 *                          --target <rust triple> --out <dir>
 *
 * The tarball is written to <out>/<target>.tgz, and the package metadata to
 * <out>/<target>.json, so the pack job can assemble parcel3's optionalDependencies
 * without having to unpack anything or know the target list itself.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {parseArgs} from 'node:util';

// Shared with the native plugin scripts: npm changed the shape of `npm pack
// --json` in v12, and a runner's default npm is whatever its image ships.
import {npmPack, reportErrors} from '../native-plugin/cli.mjs';
import {writeJson} from './util.mjs';

reportErrors();

let {values} = parseArgs({
  options: {
    package: {type: 'string'},
    version: {type: 'string'},
    binary: {type: 'string'},
    os: {type: 'string'},
    cpu: {type: 'string'},
    libc: {type: 'string', default: ''},
    target: {type: 'string'},
    out: {type: 'string'},
  },
});

for (let required of [
  'package',
  'version',
  'binary',
  'os',
  'cpu',
  'target',
  'out',
]) {
  if (!values[required]) {
    throw new Error(`Missing required argument --${required}`);
  }
}

let binary = path.resolve(values.binary);
if (!fs.existsSync(binary)) {
  throw new Error(`No binary at ${binary}`);
}

let executable = values.os === 'win32' ? 'parcel3.exe' : 'parcel3';

// Stage outside the repo so `npm pack` only ever sees the two files put here.
let stage = fs.mkdtempSync(
  path.join(process.env.RUNNER_TEMP || os.tmpdir(), 'parcel3-'),
);
fs.copyFileSync(binary, path.join(stage, executable));
// npm preserves the mode, and the launcher execs this file directly.
fs.chmodSync(path.join(stage, executable), 0o755);

let pkg = {
  name: values.package,
  version: values.version,
  description: `The parcel3 binary for ${values.os} ${values.cpu}.`,
  license: 'MIT',
  repository: {
    type: 'git',
    url: 'https://github.com/parcel-bundler/parcel.git',
  },
  // Yarn PnP keeps packages zipped by default, which leaves nothing on disk to
  // exec. This asks it to unpack the package instead.
  preferUnplugged: true,
  os: [values.os],
  cpu: [values.cpu],
  files: [executable],
};
if (values.libc) {
  // Only meaningful on Linux, and what stops a musl build being installed on a
  // glibc host and vice versa.
  pkg.libc = [values.libc];
}

writeJson(path.join(stage, 'package.json'), pkg);
console.log(`Generated package.json for ${pkg.name}:`);
console.log(JSON.stringify(pkg, null, 2));

let packed = npmPack(stage, stage);

let out = path.resolve(values.out);
fs.mkdirSync(out, {recursive: true});
// Named after the target rather than the package so the pack job can pair the
// tarball with its metadata without parsing npm's naming scheme.
fs.copyFileSync(
  path.join(stage, packed.filename),
  path.join(out, `${values.target}.tgz`),
);
writeJson(path.join(out, `${values.target}.json`), {
  name: pkg.name,
  version: pkg.version,
});

console.log(`Packed ${pkg.name}@${pkg.version} (${packed.size} bytes)`);
