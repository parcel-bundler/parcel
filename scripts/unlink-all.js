#!/usr/bin/env node

// unlinks all packages and deletes their node_modules folders
/* eslint-disable no-console */
let args = process.argv.slice(2);
if (args.length < 1) {
  console.log(
    `Usage:

    unlink_all rootdir
`,
  );
  process.exit(1);
}

const rootDir = args[0];
const {findProjects, exec} = require('./common');

//  all projects { [dirname]: package }
let projects = findProjects(rootDir);
//  all project names
let names = new Set(Object.values(projects).map(pack => pack.name));
//  clean all project node_modules folders.
let count = 0;
for (let path in projects) {
  console.log(`${++count}/${names.size} unlinking ${path}`);
  exec('yarn unlink ; rimraf node_modules', path);
}
