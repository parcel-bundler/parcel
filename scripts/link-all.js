#!/usr/bin/env node

/* eslint-disable no-console */
// links all packages that are interdependent within a directory recursively.
let args = process.argv.slice(2);
if (args.length < 1) {
  console.log(
    `Usage:

    link_all rootdir
`,
  );
  process.exit(1);
}

console.log(
  "Yarn installing and linking all packages. Ignore any 'No registered package found errors'",
);

const rootDir = args[0];
const {findProjects, exec} = require('./common');

//  all projects { [dirname]: package }
let projects = findProjects(rootDir);
//  all project names
let names = new Set(Object.values(projects).map(pack => pack.name));
//  first link all projects
let count = 0;
for (let path in projects) {
  console.log(`${++count}/${names.size} setup ${path}`);
  exec('yarn install && yarn unlink ; yarn link', path);
}
count = 0;
// then link to each other
for (let path in projects) {
  let pack = projects[path];
  console.log(`${++count}/${names.size} link ${path}`);
  for (let dep in pack.dependencies || {}) {
    if (names.has(dep)) {
      exec(`yarn link ${dep}`, path);
    }
  }
}
