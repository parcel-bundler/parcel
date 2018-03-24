require('v8-compile-cache');
const chalk = require('chalk');
const program = require('commander');
const version = require('../package.json').version;

program.version(version);

program
  .command('serve [input]')
  .description('starts a development server')
  .option(
    '-p, --port <port>',
    'set the port to serve on. defaults to 1234',
    parseInt
  )
  .option(
    '--hmr-port <port>',
    'set the port to serve HMR websockets, defaults to random',
    parseInt
  )
  .option(
    '--hmr-hostname <hostname>',
    'set the hostname of HMR websockets, defaults to location.hostname of current window'
  )
  .option('--https', 'serves files over HTTPS')
  .option('--cert <path>', 'path to certificate to use with HTTPS')
  .option('--key <path>', 'path to private key to use with HTTPS')
  .option(
    '--open [browser]',
    'automatically open in specified browser, defaults to default browser'
  )
  .option(
    '-d, --out-dir <path>',
    'set the output directory. defaults to "dist"'
  )
  .option(
    '-o, --out-file <filename>',
    'set the output filename for the application entry point.'
  )
  .option(
    '--public-url <url>',
    'set the public URL to serve on. defaults to the same as the --out-dir option'
  )
  .option('--no-hmr', 'disable hot module replacement')
  .option('--no-cache', 'disable the filesystem cache')
  .option('--no-source-maps', 'disable sourcemaps')
  .option('--no-autoinstall', 'disable autoinstall')
  .option(
    '-t, --target [target]',
    'set the runtime environment, either "node", "browser" or "electron". defaults to "browser"',
    /^(node|browser|electron)$/
  )
  .option('-V, --version', 'output the version number')
  .option(
    '--log-level <level>',
    'set the log level, either "0" (no output), "1" (errors), "2" (warnings + errors) or "3" (all).',
    /^([0-3])$/
  )
  .action(bundle);

program
  .command('watch [input]')
  .description('starts the bundler in watch mode')
  .option(
    '-d, --out-dir <path>',
    'set the output directory. defaults to "dist"'
  )
  .option(
    '-o, --out-file <filename>',
    'set the output filename for the application entry point.'
  )
  .option(
    '--public-url <url>',
    'set the public URL to serve on. defaults to the same as the --out-dir option'
  )
  .option(
    '--hmr-port <port>',
    'set the port to serve HMR websockets, defaults to random',
    parseInt
  )
  .option(
    '--hmr-hostname <hostname>',
    'set the hostname of HMR websockets, defaults to location.hostname of current window'
  )
  .option('--no-hmr', 'disable hot module replacement')
  .option('--no-cache', 'disable the filesystem cache')
  .option('--no-source-maps', 'disable sourcemaps')
  .option('--no-autoinstall', 'disable autoinstall')
  .option(
    '-t, --target [target]',
    'set the runtime environment, either "node", "browser" or "electron". defaults to "browser"',
    /^(node|browser|electron)$/
  )
  .option(
    '--log-level <level>',
    'set the log level, either "0" (no output), "1" (errors), "2" (warnings + errors) or "3" (all).',
    /^([0-3])$/
  )
  .action(bundle);

program
  .command('build [input]')
  .description('bundles for production')
  .option(
    '-d, --out-dir <path>',
    'set the output directory. defaults to "dist"'
  )
  .option(
    '-o, --out-file <filename>',
    'set the output filename for the application entry point.'
  )
  .option(
    '--public-url <url>',
    'set the public URL to serve on. defaults to the same as the --out-dir option'
  )
  .option('--no-minify', 'disable minification')
  .option('--no-cache', 'disable the filesystem cache')
  .option('--no-source-maps', 'disable sourcemaps')
  .option(
    '-t, --target <target>',
    'set the runtime environment, either "node", "browser" or "electron". defaults to "browser"',
    /^(node|browser|electron)$/
  )
  .option(
    '--detailed-report',
    'print a detailed build report after a completed build'
  )
  .option(
    '--log-level <level>',
    'set the log level, either "0" (no output), "1" (errors), "2" (warnings + errors) or "3" (all).',
    /^([0-3])$/
  )
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

// Make serve the default command except for --help
var args = process.argv;
if (args[2] === '--help' || args[2] === '-h') args[2] = 'help';
if (!args[2] || !program.commands.some(c => c.name() === args[2])) {
  args.splice(2, 0, 'serve');
}

program.parse(args);

async function bundle(main, command) {
  // Require bundler here so the help command is fast
  const Bundler = require('../');

  if (command.name() === 'build') {
    process.env.NODE_ENV = 'production';
  } else {
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  }

  if (command.cert && command.key) {
    command.https = {
      cert: command.cert,
      key: command.key
    };
  }

  const bundler = new Bundler(main, command);

  if (command.name() === 'serve') {
    const server = await bundler.serve(command.port || 1234, command.https);
    if (command.open) {
      await require('./utils/openInBrowser')(
        `${command.https ? 'https' : 'http'}://localhost:${
          server.address().port
        }`,
        command.open
      );
    }
  } else {
    bundler.bundle();
  }
}
