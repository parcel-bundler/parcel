#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const exec = require('child_process').execSync;

const fromVersionString = str => str.match(/npm:.+@(.+)$/)[1];
const toVersionString = (name, version) => `npm:${name}@${version}`;

function run(cmd) {
  let result = exec(cmd, {stdio: [0, 'pipe', 2]});
  try {
    return JSON.parse(result);
  } catch {
    return result.toString();
  }
}

let packages = run(
  `${path.join(__dirname, '..', 'node_modules', '.bin', 'lerna')} ls --json`,
);

for (let {location, name} of packages) {
  let pkgPath = path.join(location, 'package.json');
  let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.dependencies && 'self-published' in pkg.dependencies) {
    let current = fromVersionString(pkg.dependencies['self-published']);
    let info = run(`yarn info ${name} --json`);
    let nightly = info.data['dist-tags'].nightly;
    if (current === nightly) {
      console.error(`${name} is already on latest nightly ${nightly}`);
    } else {
      console.error(`updating ${name} to latest nightly ${nightly}`);
      pkg.dependencies['self-published'] = toVersionString(name, nightly);
      fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
    }
  }
}
