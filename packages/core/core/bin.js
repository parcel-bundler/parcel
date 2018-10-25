#!/usr/bin/env node
const program = require('commander');
const version = require('./package').version;

program
  .version(version)
  .option('-w, --watch', 'runs the bundler in watch mode')
  .parse(process.argv);

let entries = program.args.map(
  entry => (entry.startsWith('./') ? entry : `./${entry}`)
);
let cliOpts = {
  watch: program.watch
};
let Parcel = require('.');
let parcel = new Parcel({
  entries,
  cliOpts
});

parcel.run();
