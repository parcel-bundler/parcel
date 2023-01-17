#! /usr/bin/env node
/* eslint-disable no-console */

require('@parcel/babel-register');

const fs = require('fs').promises;
const path = require('path');

/* eslint-disable-next-line import/no-extraneous-dependencies */
const {toFixture} = require('@parcel/test-utils/src/fsFixture');

let args = process.argv.slice(2);

if (args.includes('--help')) {
  console.log('Usage: to-fs-fixture.js <fixtureName> <outputDir>');
  process.exit(0);
}

if (args.length < 1) {
  console.log(
    `Usage:

    to-fs-fixture.js <path/to/dir>
`,
  );
  process.exit(1);
}

main(args[0]);

async function main(dir) {
  let fixture = await toFixture(fs, path.resolve(dir));
  console.log(fixture.toString());
}
