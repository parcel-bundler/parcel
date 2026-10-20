/**
 * Prints the build matrix for one or more plugins, derived from the keys of each
 * `parcel.artifacts` map.
 *
 * Usage: node matrix.mjs --dirs <newline or comma separated> [--language rust|go|swift]
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
  options: {
    dirs: {type: 'string', default: '.'},
    language: {type: 'string'},
  },
});

/**
 * Which toolchain builds this plugin. The manifest is the same either way — the
 * artifact map is keyed by the target triple *Parcel* was built for, which says
 * nothing about the language the plugin is written in.
 */
const MANIFESTS = {rust: 'Cargo.toml', go: 'go.mod', swift: 'Package.swift'};

function detectLanguage(dir) {
  let found = Object.entries(MANIFESTS).filter(([, file]) =>
    fs.existsSync(path.join(dir, file)),
  );

  if (found.length > 1) {
    throw new Error(
      `${dir} contains ${found
        .map(([, file]) => file)
        .join(
          ' and ',
        )}. Pass the language input to say which one builds the plugin.`,
    );
  }
  if (found.length === 0) {
    throw new Error(
      `${dir} contains none of ${Object.values(MANIFESTS).join(
        ', ',
      )}, so there is nothing to build.`,
    );
  }

  return found[0][0];
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
  if (!(language in MANIFESTS)) {
    throw new Error(
      `Unsupported language ${JSON.stringify(
        language,
      )}; expected "rust", "go", or "swift"`,
    );
  }

  let {pkg, targets} = readPluginPackage(dir);

  if (language === 'swift') {
    let unsupported = targets.filter(target => !TARGETS[target].swift);
    if (unsupported.length > 0) {
      throw new Error(
        `${pkg.name} in ${dir} lists targets Swift plugins cannot be built for yet: ${unsupported.join(
          ', ',
        )}. Remove them from parcel.artifacts. Swift plugins support ${Object.keys(
          TARGETS,
        )
          .filter(target => TARGETS[target].swift)
          .join(', ')}.`,
      );
    }
  }
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
    // Swift builds Linux targets natively in a container, never through Zig.
    let builder =
      language === 'swift'
        ? info.os === 'darwin'
          ? 'native'
          : 'docker'
        : info.builder;
    // Empty for native builds. cargo-zigbuild and cgo are the only consumers.
    let zig = builder === 'zig' ? zigTarget(target) : '';

    include.push({
      plugin: slug,
      dir,
      language,
      target,
      package: pkg.parcel.artifacts[target],
      runner: (language === 'swift' && info.swift.runner) || info.runner,
      builder,
      zigTarget: zig,
      ext: info.ext,
      rustflags: info.rustflags ?? '',
      goos: info.go.os,
      goarch: info.go.arch,
      // cgo needs a C compiler that can target this platform. Linux cross builds
      // go through Zig, which is what pins the glibc floor; elsewhere the
      // runner's own compiler is already correct.
      cc: info.go.cc ?? `zig cc -target ${info.zigCcTarget}`,
      swiftArch: info.swift?.arch ?? '',
      swiftPlatform: info.swift?.platform ?? '',
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
