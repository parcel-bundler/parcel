/**
 * Prints the build matrix for a plugin, derived from the keys of its
 * `parcel.artifacts` map.
 *
 * Usage: node matrix.mjs --dir <plugin directory> [--language rust|go]
 */
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {reportErrors} from './cli.mjs';
import {readPluginPackage} from './plugin-package.mjs';
import {TARGETS, zigTarget} from './targets.mjs';

reportErrors();

let {values} = parseArgs({
  options: {dir: {type: 'string', default: '.'}, language: {type: 'string'}},
});

/**
 * Which toolchain builds this plugin. The manifest is the same either way — the
 * artifact map is keyed by the target triple *Parcel* was built for, which says
 * nothing about the language the plugin is written in.
 */
function detectLanguage(dir) {
  let has = file => fs.existsSync(path.join(dir, file));
  let rust = has('Cargo.toml');
  let go = has('go.mod');

  if (rust && go) {
    throw new Error(
      `${dir} contains both Cargo.toml and go.mod. Pass the language input to say which one builds the plugin.`,
    );
  }
  if (!rust && !go) {
    throw new Error(
      `${dir} contains neither Cargo.toml nor go.mod, so there is nothing to build.`,
    );
  }

  return rust ? 'rust' : 'go';
}

let language = values.language || detectLanguage(values.dir);
if (language !== 'rust' && language !== 'go') {
  throw new Error(
    `Unsupported language ${JSON.stringify(language)}; expected "rust" or "go"`,
  );
}

let {pkg, targets} = readPluginPackage(values.dir);

let include = targets.map(target => {
  let info = TARGETS[target];
  // Empty for native builds. cargo-zigbuild and cgo are the only consumers.
  let zig = info.builder === 'zig' ? zigTarget(target) : '';

  return {
    target,
    package: pkg.parcel.artifacts[target],
    runner: info.runner,
    builder: info.builder,
    zigTarget: zig,
    ext: info.ext,
    rustflags: info.rustflags ?? '',
    goos: info.go.os,
    goarch: info.go.arch,
    // cgo needs a C compiler that can target this platform. Linux cross builds
    // go through the same zig target the Rust builds use, which is what pins the
    // glibc floor; elsewhere the runner's own compiler is already correct.
    cc: info.go.cc ?? `zig cc -target ${info.zigCcTarget}`,
  };
});

let matrix = JSON.stringify({include});

console.error(
  `Building ${pkg.name}@${pkg.version} (${language}) for ${targets.length} target(s):`,
);
for (let entry of include) {
  console.error(
    `  ${entry.target} -> ${entry.package} (${entry.runner}, ${entry.builder})`,
  );
}

if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `matrix=${matrix}\nname=${pkg.name}\nversion=${pkg.version}\nlanguage=${language}\n`,
  );
}

console.log(matrix);
