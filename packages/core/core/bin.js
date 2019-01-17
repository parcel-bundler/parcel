#!/usr/bin/env node
const program = require('commander');
const version = require('./package').version;
const path = require('path');

program
  .version(version)
  .option('-w, --watch', 'runs the bundler in watch mode')
  .parse(process.argv);

let entries = program.args.map(entry => path.resolve(entry));
let cliOpts = {
  watch: program.watch
};
let Parcel = require('.');
let parcel = new Parcel({
  entries,
  cliOpts
});

// eslint-disable-next-line no-console
parcel.run().catch(console.error);
