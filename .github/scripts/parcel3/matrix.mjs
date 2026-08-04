/**
 * Prints the build matrix for parcel3, derived from the same target table the
 * native plugin workflow builds against.
 *
 * Usage: node matrix.mjs
 *
 * Sharing the table is the point: Parcel and the plugins it loads have to be
 * built for the same set of targets anyway, and a new one should only ever have
 * to be added in `native-plugin/targets.mjs`.
 */
import fs from 'node:fs';

import {reportErrors} from '../native-plugin/cli.mjs';
import {TARGETS, zigTarget} from '../native-plugin/targets.mjs';

reportErrors();

/**
 * The platform package holding the binary for a target.
 *
 * `launcher.js` derives the same name from process.platform and process.arch at
 * run time. It is a formula rather than a list on both sides precisely so that
 * adding a target means touching neither.
 */
function packageName(info) {
  return `@parcel/parcel3-${info.os}-${info.cpu}${
    info.libc === 'musl' ? '-musl' : ''
  }`;
}

let include = Object.entries(TARGETS).map(([target, info]) => ({
  target,
  runner: info.runner,
  builder: info.builder,
  // Empty for native builds; cargo-zigbuild is the only consumer.
  zigTarget: info.builder === 'zig' ? zigTarget(target) : '',
  package: packageName(info),
  os: info.os,
  cpu: info.cpu,
  libc: info.libc ?? '',
  rustflags: info.rustflags ?? '',
}));

let names = new Map();
for (let entry of include) {
  if (names.has(entry.package)) {
    throw new Error(
      `${names.get(entry.package)} and ${entry.target} would both publish as ${
        entry.package
      }`,
    );
  }
  names.set(entry.package, entry.target);

  console.error(
    `${entry.target} -> ${entry.package} (${entry.runner}, ${entry.builder})`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `matrix=${JSON.stringify({include})}\n`,
  );
}

console.log(JSON.stringify({include}));
