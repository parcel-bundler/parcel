#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const exec = require('child_process').execSync;

const UPSTREAM = /github.+parcel-bundler\/parcel/;
const NIGHTLY = /.*-nightly\..*/;

if (process.argv.includes('-h') || process.argv.includes('--help')) {
  console.log(
    [
      `  Usage: ${path.basename(process.argv[1])} [opts]`,
      '',
      '  Options:',
      '    -h, --help       Show help',
      '    -a               Add updated files to git index',
      '                     (handy in a precommit hook)',
      '',
      '  Looks for self-published packages (e.g., @parcel/transformer-js),',
      '  and compares their nightly version numbers to the list',
      '  of published nightly versions (via `yarn info`).',
      '  If it finds a version that is newer, it updates the version',
      '  in the package.json.',
      '',
      '  It will use the oldest nightly version that is newer than',
      '  the latest common commit between HEAD and the upstream default branch.',
    ].join('\n'),
  );
  process.exit();
}

const shouldStage = process.argv.includes('-a');

const fromVersionString = str => str.match(/npm:.+@(.+)$/)[1];
const toVersionString = (name, version) => `npm:${name}@${version}`;

function run(cmd) {
  let result = exec(cmd, {stdio: [0, 'pipe', 2]});
  try {
    return JSON.parse(result);
  } catch (e) {
    if (e instanceof SyntaxError) {
      return result.toString().trim();
    } else {
      throw e;
    }
  }
}

function getUpstreamRemoteName() {
  for (let name of run(`git remote`).split(/\s+/)) {
    if (UPSTREAM.test(run(`git remote get-url ${name}`))) {
      return name;
    }
  }
  throw new Error('Could not determine an upstream remote name!');
}

function getDefaultBranchName(remote) {
  return run(`git rev-parse --abbrev-ref ${remote}`).split(`${remote}/`).pop();
}

/**
 * Check nightly version timestamps for the given `pkgName`
 * in reverse chronological order, returning the version
 * with the timestamp closest to `time` without being younger.
 */
function getNearestNightlyVersion(pkgName, time) {
  let candidate = null;
  let info = run(`yarn info ${pkgName} --json`);
  let versions = [...Object.entries(info.data.time)].reverse();
  for (let [version, timestamp] of versions) {
    if (NIGHTLY.test(version)) {
      let versionTime = new Date(timestamp);
      if (versionTime < time) break;
      candidate = version;
    }
  }
  return candidate;
}

console.log(`Updating self-published (nightly) versions...`);

let packages = run(
  `${path.join(__dirname, '..', 'node_modules', '.bin', 'lerna')} ls --json`,
);

// Fetch the default upstream branch...
let upstream = getUpstreamRemoteName();
let branch = getDefaultBranchName(upstream);
run(`git fetch -q ${upstream} ${branch}`);
// ...so we can determine the latest common ancestor commit.
let baseRef = run(`git merge-base HEAD ${upstream}/${branch}`).split(/\s+/)[0];
// Get the commit time of the latest common ancestor between HEAD and upstream.
let baseRefTime = new Date(run(`git show -s --format=%cI ${baseRef}`));

for (let {location, name} of packages) {
  let pkgPath = path.join(location, 'package.json');
  let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.dependencies && 'self-published' in pkg.dependencies) {
    let current = fromVersionString(pkg.dependencies['self-published']);
    let nightly = getNearestNightlyVersion(name, baseRefTime);
    if (nightly && current !== nightly) {
      console.log(`updating ${name} to nearest nightly ${nightly}`);
      pkg.dependencies['self-published'] = toVersionString(name, nightly);
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
      if (shouldStage) run(`git add -u ${pkgPath}`);
    }
  }
}
