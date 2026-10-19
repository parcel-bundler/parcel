/**
 * Chooses the npm dist-tag to publish a version under.
 *
 * Usage:
 *   node dist-tag.mjs --version <version> [--tag <tag>]
 *
 * An explicit tag always wins. Otherwise a prerelease is published under its
 * prerelease identifier — 1.0.0-alpha.3 goes to `alpha` — and only a stable
 * version becomes `latest`. npm would otherwise tag every publish `latest`, so a
 * prerelease would become what everyone installs by default.
 */
import {parseArgs} from 'node:util';
import {fileURLToPath} from 'node:url';

import {reportErrors} from './cli.mjs';

export function distTag(version, tag) {
  if (tag) {
    return tag;
  }

  // Build metadata (+...) is not part of the prerelease identifier.
  let prerelease = version.split('+')[0].split('-').slice(1).join('-');
  if (!prerelease) {
    return 'latest';
  }

  let identifier = prerelease.split('.')[0];
  // npm refuses tags that parse as a version range, which a purely numeric
  // identifier (1.0.0-1) would.
  if (/^\d+$/.test(identifier)) {
    return 'next';
  }
  return identifier;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  reportErrors();

  let {values} = parseArgs({
    options: {
      version: {type: 'string'},
      tag: {type: 'string', default: ''},
    },
  });

  if (!values.version) {
    throw new Error('Missing required argument --version');
  }

  console.log(distTag(values.version, values.tag));
}
