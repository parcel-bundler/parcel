#!/usr/bin/env node

/* eslint-disable no-console */

// Custom git merge driver for @atlassian/parcel package.json files

let fs = require('fs');
let spawnSync = require('child_process').spawnSync;

function merge(ours, base, theirs) {
  return spawnSync(
    'git',
    [
      'merge-file',
      '-p',
      '-L',
      'current',
      '-L',
      'base',
      '-L',
      'incoming',
      ours,
      base,
      theirs,
    ],
    {stdio: [0, 'pipe', 2]},
  );
}

function loadPackageJson(filepath) {
  return JSON.parse(fs.readFileSync(filepath, 'utf-8'));
}

function writePackageJson(filepath, data) {
  return fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function copyValue(path, ours, base, theirs) {
  let name = path;
  if (Array.isArray(path)) {
    for (let i = 0; i < path.length - 1; i++) {
      ours = ours?.[path[i]];
      base = base?.[path[i]];
      theirs = theirs?.[path[i]];
    }
    name = path[path.length - 1];
  }
  if (
    ours &&
    name in ours &&
    base &&
    name in base &&
    theirs &&
    name in theirs
  ) {
    base[name] = ours[name];
    theirs[name] = ours[name];
    return true;
  }
  return false;
}

let cfg = {
  // @parcel packages that are versioned separately from parcel
  // (e.g., not in the monorepo) should be explicitly excluded.
  '@parcel/css': false,
  '@parcel/source-map': false,
  '@parcel/watcher': false,

  // Packages that should be patched but don't match @parcel/*
  fuzzer: true,
  parcel: true,
};

function shouldPatch(name) {
  return name && (cfg[name] ?? name.startsWith('@parcel/'));
}

function patchVersions(ours, base, theirs) {
  let patched = copyValue('version', ours, base, theirs);
  patched = copyValue(['engines', 'parcel'], ours, base, theirs) || patched;
  for (let type of [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'parcelDependencies',
  ]) {
    if (type in ours) {
      for (let name in ours[type]) {
        if (shouldPatch(name)) {
          patched = copyValue([type, name], ours, base, theirs) || patched;
        }
      }
    }
  }
  return patched;
}

if (require.main === module) {
  let args = process.argv.slice(2);
  if (args.length < 4) {
    console.log(
      `To use this merge driver, do the following:

       git config merge.atlassian-package-json.name "Merge driver for @atlassian/parcel package.json files"
       git config merge.atlassian-package-json.driver "./scripts/atlassian-merge-package-json.js %A %O %B %P"
     `,
    );
    process.exit(1);
  }

  let [ours, base, theirs, src] = args;

  // Try a merge first. Maybe it will be fine?
  let {stdout, status} = merge(ours, base, theirs);

  // Non-zero status means the merge failed.
  if (status) {
    try {
      let ourJson = loadPackageJson(ours);
      if (shouldPatch(ourJson.name)) {
        let baseJson = loadPackageJson(base);
        let theirJson = loadPackageJson(theirs);
        if (patchVersions(ourJson, baseJson, theirJson)) {
          console.error(`Patching Parcel versions in ${src}`);
          writePackageJson(base, baseJson);
          writePackageJson(theirs, theirJson);
          // Try to merge again after patching version numbers.
          ({stdout, status} = merge(ours, base, theirs));
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  // from `man gitattributes`:
  // > The merge driver is expected to leave the result of the merge
  // > in the file named with %A by overwriting it, and exit
  // > with zero status if it managed to merge them cleanly,
  // > or non-zero if there were conflicts.
  fs.writeFileSync(ours, stdout);
  process.exit(status);
}
