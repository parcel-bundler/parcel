#!/usr/bin/env node

/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const exec = require('child_process').execSync;

const fromVersionString = str => str.match(/npm:.+@(.+)$/)[1];
const toVersionString = (name, version) => `npm:${name}@${version}`;

let packages = JSON.parse(
  exec(
    `${path.join(__dirname, '..', 'node_modules', '.bin', 'lerna')} ls --json`,
    {stdio: [0, 'pipe', 2]},
  ),
);

for (let {location, name} of packages) {
  let pkgPath = path.join(location, 'package.json');
  let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.dependencies && 'self-published' in pkg.dependencies) {
    let current = fromVersionString(pkg.dependencies['self-published']);
    let info = JSON.parse(
      exec(`yarn info ${name} --json`, {stdio: [0, 'pipe', 2]}),
    );
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
