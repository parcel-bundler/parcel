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
      '    -o               Only run if a merge with upstream is in progress',
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
const upstreamMergeOnly = process.argv.includes('-o');

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
  try {
    for (let name of run(`git remote`).split(/\s+/)) {
      if (UPSTREAM.test(run(`git remote get-url ${name}`))) {
        return name;
      }
    }
  } catch {
    // fall through to error
  }
  throw new Error('Could not determine an upstream remote name!');
}

function getDefaultBranchName(remote) {
  try {
    return run(`git symbolic-ref refs/remotes/${remote}/HEAD`)
      .split(`${remote}/`)
      .pop();
  } catch (e) {
    throw new Error(`Could not determine default branch for ${remote}!`);
  }
}

function getMergeHead() {
  try {
    return run(
      `git name-rev --name-only --exclude=tags/* --no-undefined MERGE_HEAD`,
    );
  } catch (e) {
    // noop
  }
  return null;
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

let upstream = getUpstreamRemoteName();
let branch;

// When restricting to upstream merges only, we are interested in two cases:
//   1. A successful fast-forward or automatic merge with an upstream branch.
//      In this case, we expect to run in a postmerge hook, so the reflog
//      will show something like `merge refs/remotes/<remote>/<branch>:`.
//   2. A merge with an upstream branch that has conflicts. In this case,
//      we expect to run in a precommit hook, so the reflog won't reflect
//      the merge yet. Instead, we will look for the MERGE_HEAD to see
//      if this is a merge with an upstream branch.
if (upstreamMergeOnly) {
  // Check for MERGE_HEAD first, since it's possible that the reflog could show
  // a previous merge while we are commiting a newer merge with conflicts,
  // and if we checked the reflog first, we'd mistakenly assume
  // that it is the merge we're interested in.
  let mergeHead = getMergeHead();
  if (mergeHead) {
    if (!mergeHead.includes(`${upstream}/`)) {
      console.log('Not an upstream merge; skipping self-published update.');
      process.exit(1);
    }
    branch = mergeHead.split(`${upstream}/`).pop();
  } else {
    let reflogSubject = run(`git reflog -1 --format=%gs`).trim();
    if (reflogSubject.startsWith('merge')) {
      // In this case, the merged branch is described in the reflog subject,
      // so we can simply check if includes the upstream remote name.
      if (!reflogSubject.includes(`refs/remotes/${upstream}/`)) {
        console.log('Not an upstream merge; skipping self-published update.');
        process.exit(1);
      }
      branch = reflogSubject.split(`refs/remotes/${upstream}/`).pop();
    } else {
      console.log('No merge in progress; skipping self-published update.');
      process.exit(1);
    }
  }
} else {
  // Fetch the default upstream branch...
  branch = getDefaultBranchName(upstream);
  run(`git fetch -q ${upstream} ${branch}`);
}

let packages = run(
  `${path.join(__dirname, '..', 'node_modules', '.bin', 'lerna')} ls --json`,
);

// Determine the latest common ancestor commit.
let baseRef = run(`git merge-base HEAD ${upstream}/${branch}`).split(/\s+/)[0];
// Get the commit time of the latest common ancestor between HEAD and upstream.
let baseRefTime = new Date(run(`git show -s --format=%cI ${baseRef}`));

// This script should exit with an error if no versions were updated.
let updated = 0;
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
      updated++;
    }
  }
}
process.exit(updated ? 0 : 1);
