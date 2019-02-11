// @flow
require('v8-compile-cache');
import type {ParcelConfig, ParcelOptions} from '@parcel/types';
const chalk = require('chalk');
const program = require('commander');
const version = require('../package.json').version;
const path = require('path');

program.version(version);

// --no-cache, --cache-dir, --no-source-maps, --no-autoinstall, --global?, --public-url, --log-level
// --no-content-hash, --experimental-scope-hoisting, --detailed-report

var commonOptions = {
  '--no-cache': 'disable the filesystem cache',
  '--cache-dir <path>': 'set the cache directory. defaults to ".parcel-cache"',
  '--no-source-maps': 'disable sourcemaps',
  '--no-autoinstall': 'disable autoinstall',
  '--public-url <url>': 'set the public URL to serve on. defaults to "/"',
  '--log-level <level>': [
    'set the log level, either "none", "error", "warn", "info", or "verbose".',
    /^(none|error|warn|info|verbose)$/
  ],
  '-V, --version': 'output the version number'
};

var hmrOptions = {
  '--no-hmr': 'disable hot module replacement',
  '--hmr-port <port>': [
    'set the port to serve HMR websockets, defaults to random',
    parseInt
  ],
  '--hmr-host <hostname>':
    'set the hostname of HMR websockets, defaults to location.hostname of current window',
  '--https': 'serves files over HTTPS',
  '--cert <path>': 'path to certificate to use with HTTPS',
  '--key <path>': 'path to private key to use with HTTPS'
};

function applyOptions(cmd, options) {
  for (let opt in options) {
    cmd.option(
      opt,
      ...(Array.isArray(options[opt]) ? options[opt] : [options[opt]])
    );
  }
}

let serve = program
  .command('serve [input...]')
  .description('starts a development server')
  .option(
    '-p, --port <port>',
    'set the port to serve on. defaults to 1234',
    parseInt
  )
  .option(
    '--host <host>',
    'set the host to listen on, defaults to listening on all interfaces'
  )
  .option(
    '--open [browser]',
    'automatically open in specified browser, defaults to default browser'
  )
  .action(run);

applyOptions(serve, hmrOptions);
applyOptions(serve, commonOptions);

let watch = program
  .command('watch [input...]')
  .description('starts the bundler in watch mode')
  .action(run);

applyOptions(watch, hmrOptions);
applyOptions(watch, commonOptions);

let build = program
  .command('build [input...]')
  .description('bundles for production')
  .action(run);

applyOptions(build, commonOptions);

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

function run(entries: Array<string>, command: any) {
  entries = entries.map(entry => path.resolve(entry));

  if (entries.length === 0) {
    console.log('No entries found');
    return;
  }
  let Parcel = require('@parcel/core').default;
  let defaultConfig: ParcelConfig = require('@parcel/config-default');
  let parcel = new Parcel({
    entries,
    defaultConfig: {
      ...defaultConfig,
      filePath: require.resolve('@parcel/config-default')
    },
    ...normalizeOptions(command)
  });

  parcel.run().catch(console.error);
}

function normalizeOptions(command): ParcelOptions {
  if (command.name() === 'build') {
    process.env.NODE_ENV = process.env.NODE_ENV || 'production';
  } else {
    process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  }

  let https = !!command.https;
  if (command.cert && command.key) {
    https = {
      cert: command.cert,
      key: command.key
    };
  }

  let serve = false;
  if (command.name() === 'serve') {
    serve = {
      https,
      port: command.port,
      host: command.host
    };
  }

  let hmr = false;
  if (command.name() !== 'build' && command.hmr !== false) {
    hmr = {
      https,
      port: command.hmrPort || command.port,
      host: command.hmrHost || command.host
    };
  }

  let mode = command.name() === 'build' ? 'production' : 'development';
  return {
    watch: command.name() === 'watch' || command.name() === 'serve',
    cache: command.cache !== false,
    cacheDir: command.cacheDir,
    mode,
    minify: command.minify != null ? command.minify : mode === 'production',
    sourceMaps: command.sourceMaps != false,
    publicUrl: command.publicUrl,
    hmr,
    serve,
    autoinstall: command.autoinstall !== false,
    logLevel: command.logLevel
  };
}
