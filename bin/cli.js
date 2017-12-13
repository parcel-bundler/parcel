#!/usr/bin/env node

require('v8-compile-cache');
const chalk = require('chalk');
const program = require('commander');
const version = require('../package.json').version;

program.version(version);

program
  .command('serve [input]')
  .description('starts a development server')
  .option('-p, --port <port>', 'set the port to serve on. defaults to 1234')
  .option('-o, --open', 'automatically open in default browser')
  .option(
    '-d, --out-dir <path>',
    'set the output directory. defaults to "dist"'
  )
  .option(
    '--public-url <url>',
    'set the public URL to serve on. defaults to the same as the --out-dir option'
  )
  .option('--no-hmr', 'disable hot module replacement')
  .option('--no-cache', 'disable the filesystem cache')
  .option('-V, --version', 'output the version number')
  .action(bundle);

program
  .command('watch [input]')
  .description('starts the bundler in watch mode')
  .option(
    '-d, --out-dir <path>',
    'set the output directory. defaults to "dist"'
  )
  .option(
    '--public-url <url>',
    'set the public URL to serve on. defaults to the same as the --out-dir option'
  )
  .option('--no-hmr', 'disable hot module replacement')
  .option('--no-cache', 'disable the filesystem cache')
  .action(bundle);

program
  .command('build [input]')
  .description('bundles for production')
  .option(
    '-d, --out-dir <path>',
    'set the output directory. defaults to "dist"'
  )
  .option(
    '--public-url <url>',
    'set the public URL to serve on. defaults to the same as the --out-dir option'
  )
  .option('--no-minify', 'disable minification')
  .option('--no-cache', 'disable the filesystem cache')
  .action(bundle);

program
  .command('help [command]')
  .description('display help information for a command')
  .action(function(command) {
    let cmd = program.commands.find(c => c.name() === command) || program;
    cmd.help();
  });

program.on('--help', function() {
  console.log('');
  console.log(
    '  Run `' +
      chalk.bold('parcel help <command>') +
      '` for more information on specific commands'
  );
  console.log('');
});

var args = process.argv;
if (!args[2]) {
  // no entry point.
  displayWarningMessage();
} else if (args[2] && args[2] === 'serve') {
  // serve but with no entry point.
  displayWarningMessage('serve');
} else {
  args.splice(2, 0, 'serve');
  program.parse(args);
}

function displayWarningMessage(command = '') {
  console.error('Please specify the entry point.');
  console.log('For example:');
  console.log(
    `  ${chalk.cyan(program.name())} ${chalk.green(
      `parcel index.html ${command}`
    )}`
  );
  console.log();
  console.log(
    `Run ${chalk.cyan(`${program.name()} --help`)} to see all options.`
  );
  process.exit(1);
}

async function bundle(main, command) {
  // Require bundler here so the help command is fast
  const Bundler = require('../');

  if (command.name() === 'build') {
    process.env.NODE_ENV = 'production';
  } else {
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  }

  const bundler = new Bundler(main, command);

  if (command.name() === 'serve') {
    const server = await bundler.serve(command.port || 1234);
    if (command.open) {
      require('opn')(`http://localhost:${server.address().port}`);
    }
  } else {
    bundler.bundle();
  }
}
