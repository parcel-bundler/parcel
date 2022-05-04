#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const exec = require('child_process').execSync;

const UPSTREAM = /github.+parcel-bundler\/parcel/;
const NIGHTLY = /.*-nightly\..*/;

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
  let candidate;
  let info = run(`yarn info ${pkgName} --json`);
  let versions = [...Object.entries(info.data.time)].reverse();
  for (let [version, timestamp] of versions) {
    if (NIGHTLY.test(version)) {
      let versionTime = new Date(timestamp);
      if (versionTime >= time) {
        candidate = version;
      } else {
        break;
      }
    }
  }
  if (candidate) return candidate;
  throw new Error('Could not determine an appropriate nightly version!');
}

let packages = run(
  `${path.join(__dirname, '..', 'node_modules', '.bin', 'lerna')} ls --json`,
);

// Fetch the default upstream branch...
let upstream = getUpstreamRemoteName();
let branch = getDefaultBranchName(upstream);
run(`git fetch ${upstream} ${branch}`);
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
    if (current === nightly) {
      console.log(`${name} is already on nearest nightly ${nightly}`);
    } else {
      console.log(`updating ${name} to nearest nightly ${nightly}`);
      pkg.dependencies['self-published'] = toVersionString(name, nightly);
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  }
}
