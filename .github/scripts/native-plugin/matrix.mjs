/**
 * Prints the build matrix for a plugin, derived from the keys of its
 * `parcel.artifacts` map.
 *
 * Usage: node matrix.mjs --dir <plugin directory>
 */
import fs from 'node:fs';
import {parseArgs} from 'node:util';

import {reportErrors} from './cli.mjs';
import {readPluginPackage} from './plugin-package.mjs';
import {TARGETS, zigTarget} from './targets.mjs';

reportErrors();

let {values} = parseArgs({options: {dir: {type: 'string', default: '.'}}});

let {pkg, targets} = readPluginPackage(values.dir);

let include = targets.map(target => {
  let info = TARGETS[target];
  return {
    target,
    package: pkg.parcel.artifacts[target],
    runner: info.runner,
    builder: info.builder,
    // Empty for native builds. cargo-zigbuild is the only consumer.
    zigTarget: info.builder === 'zig' ? zigTarget(target) : '',
    ext: info.ext,
    rustflags: info.rustflags ?? '',
  };
});

let matrix = JSON.stringify({include});

console.error(
  `Building ${pkg.name}@${pkg.version} for ${targets.length} target(s):`,
);
for (let entry of include) {
  console.error(
    `  ${entry.target} -> ${entry.package} (${entry.runner}, ${entry.builder})`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `matrix=${matrix}\nname=${pkg.name}\nversion=${pkg.version}\n`,
  );
}

console.log(matrix);
