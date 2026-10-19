/**
 * Publishes packed tarballs to npm, in the order given, each under the dist-tag
 * its version calls for (see dist-tag.mjs).
 *
 * Usage:
 *   node publish.mjs [--tag <tag>] <tarball>...
 *
 * The order matters: a package's optionalDependencies pin exact versions of its
 * platform packages, so those have to be passed, and published, first.
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

for (let tarball of tarballs) {
  let pkg = JSON.parse(
    execFileSync('tar', ['-xzOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
    }),
  );
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
