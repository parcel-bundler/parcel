#!/usr/bin/env node

require('v8-compile-cache');
const chalk = require('chalk');
const program = require('commander');
const version = require('../package.json').version;

program.version(version);

program.command('serve [input]')
  .description('starts a development server')
  .option('-p, --port <port>', 'set the port to serve on. defaults to 1234')
  .option('-d, --out-dir <path>', 'set the output directory. defaults to "dist"')
  .option('--public-url <url>', 'set the public URL to serve on. defaults to the same as the --out-dir option')
  .option('--no-hmr', 'disable hot module replacement')
  .option('--no-cache', 'disable the filesystem cache')
  .action(bundle);

program.command('watch [input]')
  .description('starts the bundler in watch mode')
  .option('-d, --out-dir <path>', 'set the output directory. defaults to "dist"')
  .option('--public-url <url>', 'set the public URL to serve on. defaults to the same as the --out-dir option')
  .option('--no-hmr', 'disable hot module replacement')
  .option('--no-cache', 'disable the filesystem cache')
  .action(bundle);

program.command('build [input]')
  .description('bundles for production')
  .option('-d, --out-dir <path>', 'set the output directory. defaults to "dist"')
  .option('--public-url <url>', 'set the public URL to serve on. defaults to the same as the --out-dir option')
  .option('--no-minify', 'disable minification')
  .option('--no-cache', 'disable the filesystem cache')
  .action(bundle);

program.command('help [command]')
  .description('display help information for a command')
  .action(function (command) {
    let cmd = program.commands.find(c => c.name() === command) || program;
    cmd.help();
  });

program.on('--help', function () {
  console.log('');
  console.log('  Run `' + chalk.bold('parcel help <command>') + '` for more information on specific commands');
  console.log('');
});

// Make serve the default command
var args = process.argv;
if (!args[2] || !program.commands.some(c => c.name() === args[2])) {
  args.splice(2, 0, 'serve');
}

program.parse(args);

function bundle(main, command) {
  // Require bundler here so the help command is fast
  const Bundler = require('../');

  if (command.name() === 'build') {
    process.env.NODE_ENV = 'production';
  }

  const bundler = new Bundler(main, command);

  if (command.name() === 'serve') {
    bundler.serve(command.port || 1234);
  } else {
    bundler.bundle();
  }
}
