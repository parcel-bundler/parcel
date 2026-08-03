/**
 * Prints the build matrix for one or more plugins, derived from the keys of each
 * `parcel.artifacts` map.
 *
 * Usage: node matrix.mjs --dirs <newline or comma separated> [--language rust|go]
 *
 * Every entry carries the plugin it belongs to, so a monorepo releasing several
 * plugins at once keeps their artifacts apart. Sharing one workflow run is also
 * what lets publishing wait for *all* of them, rather than pushing half a release
 * when one plugin fails to build.
 */
import fs from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {reportErrors} from './cli.mjs';
import {readPluginPackage} from './plugin-package.mjs';
import {TARGETS, zigTarget} from './targets.mjs';

reportErrors();

let {values} = parseArgs({
  options: {dirs: {type: 'string', default: '.'}, language: {type: 'string'}},
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

/**
 * A token identifying the plugin in artifact names, which cannot contain the `@`
 * and `/` an npm scope brings along.
 */
function slugify(name) {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
}

let dirs = values.dirs
  .split(/[\n,]/)
  .map(dir => dir.trim())
  .filter(Boolean);

if (dirs.length === 0) {
  throw new Error('No plugin directories given');
}

let plugins = [];
let include = [];
let slugs = new Map();

for (let dir of dirs) {
  let language = values.language || detectLanguage(dir);
  if (language !== 'rust' && language !== 'go') {
    throw new Error(
      `Unsupported language ${JSON.stringify(
        language,
      )}; expected "rust" or "go"`,
    );
  }

  let {pkg, targets} = readPluginPackage(dir);
  let slug = slugify(pkg.name);

  if (slugs.has(slug)) {
    throw new Error(
      `${pkg.name} in ${dir} and ${slugs.get(
        slug,
      )} would share the artifact name ${slug}`,
    );
  }
  slugs.set(slug, `${pkg.name} in ${dir}`);

  plugins.push({
    plugin: slug,
    dir,
    name: pkg.name,
    version: pkg.version,
    language,
  });

  for (let target of targets) {
    let info = TARGETS[target];
    // Empty for native builds. cargo-zigbuild and cgo are the only consumers.
    let zig = info.builder === 'zig' ? zigTarget(target) : '';

    include.push({
      plugin: slug,
      dir,
      language,
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
      // go through Zig, which is what pins the glibc floor; elsewhere the
      // runner's own compiler is already correct.
      cc: info.go.cc ?? `zig cc -target ${info.zigCcTarget}`,
    });
  }
}

for (let plugin of plugins) {
  console.error(
    `${plugin.name}@${plugin.version} (${plugin.language}) from ${plugin.dir}:`,
  );
  for (let entry of include.filter(e => e.plugin === plugin.plugin)) {
    console.error(
      `  ${entry.target} -> ${entry.package} (${entry.runner}, ${entry.builder})`,
    );
  }
}

if (process.env.GITHUB_OUTPUT) {
  // name/version/language describe the single-plugin case. A multi-plugin run
  // leaves them empty rather than picking one arbitrarily.
  let only =
    plugins.length === 1 ? plugins[0] : {name: '', version: '', language: ''};

  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    [
      `matrix=${JSON.stringify({include})}`,
      `plugins=${JSON.stringify({include: plugins})}`,
      `name=${only.name}`,
      `version=${only.version}`,
      `language=${only.language}`,
      '',
    ].join('\n'),
  );
}

console.log(JSON.stringify({include}));
