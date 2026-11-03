/**
 * Publishes packed tarballs to npm, each under the dist-tag its version calls
 * for (see dist-tag.mjs).
 *
 * Usage:
 *   node publish.mjs [--tag <tag>] <tarball>...
 *
 * A package is published after any of the others it depends on, so that it is
 * never resolvable before them: a plugin package's optionalDependencies pin
 * exact versions of its platform packages, and @parcel/plugin has to precede
 * the transformers that depend on it. Packages with no such relation keep the
 * order given.
 *
 * Versions already on the registry are skipped, so a run that failed partway
 * through can be retried.
 *
 * Each tarball's version is read from the package.json inside it, so tarballs
 * of packages at different versions can be published together.
 */
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import {parseArgs} from 'node:util';

import {reportErrors} from './cli.mjs';
import {distTag} from './dist-tag.mjs';

reportErrors();

let {values, positionals: tarballs} = parseArgs({
  allowPositionals: true,
  options: {
    tag: {type: 'string', default: ''},
  },
});

if (tarballs.length === 0) {
  throw new Error('No tarballs to publish');
}

let packages = tarballs.map(tarball => ({
  tarball,
  pkg: JSON.parse(
    execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
    }),
  ),
}));

for (let {tarball, pkg} of dependencyOrder(packages)) {
  if (isPublished(pkg.name, pkg.version)) {
    console.log(`${pkg.name}@${pkg.version} is already published; skipping.`);
    continue;
  }

  let tag = distTag(pkg.version, values.tag);
  console.log(
    `::group::npm publish ${path.basename(tarball)} (${pkg.name}@${
      pkg.version
    } --tag ${tag})`,
  );
  execFileSync(
    'npm',
    ['publish', tarball, '--access', 'public', '--tag', tag],
    {stdio: 'inherit'},
  );
  console.log('::endgroup::');
}

/**
 * Orders packages so each comes after those among them it depends on, keeping
 * the given order wherever dependencies don't decide it.
 */
function dependencyOrder(packages) {
  let names = new Set(packages.map(({pkg}) => pkg.name));
  let remaining = packages.map(entry => ({
    entry,
    deps: new Set(
      [
        entry.pkg.dependencies,
        entry.pkg.optionalDependencies,
        entry.pkg.peerDependencies,
      ]
        .flatMap(deps => Object.keys(deps ?? {}))
        .filter(name => names.has(name) && name !== entry.pkg.name),
    ),
  }));

  let ordered = [];
  let done = new Set();
  while (remaining.length > 0) {
    let index = remaining.findIndex(({deps}) =>
      [...deps].every(name => done.has(name)),
    );
    if (index === -1) {
      throw new Error(
        `Dependency cycle between ${remaining
          .map(({entry}) => entry.pkg.name)
          .join(', ')}`,
      );
    }
    let [{entry}] = remaining.splice(index, 1);
    ordered.push(entry);
    done.add(entry.pkg.name);
  }
  return ordered;
}

function isPublished(name, version) {
  let output;
  try {
    output = execFileSync(
      'npm',
      ['view', name, 'versions', '--json', '--prefer-online'],
      {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']},
    );
  } catch (err) {
    // A package that has never been published at all.
    if (/\bE404\b/.test(`${err.stdout}${err.stderr}`)) {
      return false;
    }
    throw err;
  }

  // A single version comes back as a string rather than an array.
  return [JSON.parse(output)].flat().includes(version);
}
