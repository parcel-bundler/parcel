/**
 * Points the templates at the Parcel version being published, e.g. `^3.0.0-alpha.1`
 * when create-parcel itself is 3.0.0-alpha.1. Runs on prepack, after the release
 * workflow has set every package's version.
 *
 * Only packages released in lockstep with create-parcel are updated: `parcel`,
 * which is assembled from the native builds, and the public workspace packages
 * such as @parcel/rsc.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const packages = path.join(root, '..');

let {version} = readJson(path.join(root, 'package.json'));
let range = `^${version}`;

let lockstep = new Set(['parcel']);
for (let dir of fs.readdirSync(packages)) {
  let file = path.join(packages, dir, 'package.json');
  if (fs.existsSync(file)) {
    let pkg = readJson(file);
    if (!pkg.private) {
      lockstep.add(pkg.name);
    }
  }
}

let templates = path.join(root, 'templates');
for (let template of fs.readdirSync(templates)) {
  let file = path.join(templates, template, 'package.json');
  let pkg = readJson(file);
  for (let field of ['dependencies', 'devDependencies']) {
    for (let name in pkg[field]) {
      if (lockstep.has(name)) {
        pkg[field][name] = range;
      }
    }
  }
  fs.writeFileSync(file, JSON.stringify(pkg, null, 2) + '\n');
  console.log(`Updated ${template} to ${range}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
