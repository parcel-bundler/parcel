// @flow

import type {RawParcelConfig, InitialParcelOptions} from '@parcel/types';
import {BuildError} from '@parcel/core';
import {NodePackageManager} from '@parcel/package-manager';
import {NodeFS} from '@parcel/fs';
import ThrowableDiagnostic from '@parcel/diagnostic';
import {prettyDiagnostic, openInBrowser} from '@parcel/utils';
import {INTERNAL_ORIGINAL_CONSOLE} from '@parcel/logger';

require('v8-compile-cache');

async function logUncaughtError(e: mixed) {
  if (e instanceof ThrowableDiagnostic) {
    for (let diagnostic of e.diagnostics) {
      let out = await prettyDiagnostic(diagnostic);
      INTERNAL_ORIGINAL_CONSOLE.error(out.message);
      INTERNAL_ORIGINAL_CONSOLE.error(out.codeframe || out.stack);
      for (let h of out.hints) {
        INTERNAL_ORIGINAL_CONSOLE.error(h);
      }
    }
  } else {
    INTERNAL_ORIGINAL_CONSOLE.error(e);
  }

  // A hack to definitely ensure we logged the uncaught exception
  await new Promise(resolve => setTimeout(resolve, 100));
}

process.on('unhandledRejection', async (reason: mixed) => {
  await logUncaughtError(reason);
  process.exit();
});

const chalk = require('chalk');
const program = require('commander');
const path = require('path');
const getPort = require('get-port');
const version = require('../package.json').version;

// Capture the NODE_ENV this process was launched with, so that it can be
// used in Parcel (such as in process.env inlining).
const initialNodeEnv = process.env.NODE_ENV;
// Then, override NODE_ENV to be PARCEL_BUILD_ENV (replaced with `production` in builds)
// so that dependencies of Parcel like React (which renders the cli through `ink`)
// run in the appropriate mode.
if (typeof process.env.PARCEL_BUILD_ENV === 'string') {
  process.env.NODE_ENV = process.env.PARCEL_BUILD_ENV;
}

program.version(version);

// --no-cache, --cache-dir, --no-source-maps, --no-autoinstall, --global?, --public-url, --log-level
// --no-content-hash, --experimental-scope-hoisting, --detailed-report

const commonOptions = {
  '--no-cache': 'disable the filesystem cache',
  '--cache-dir <path>': 'set the cache directory. defaults to ".parcel-cache"',
  '--no-source-maps': 'disable sourcemaps',
  '--no-autoinstall': 'disable autoinstall',
  '--no-content-hash': 'disable content hashing',
  '--target [name]': [
    'only build given target(s)',
    (val, list) => list.concat([val]),
    [],
  ],
  '--log-level <level>': [
    'set the log level, either "none", "error", "warn", "info", or "verbose".',
    /^(none|error|warn|info|verbose)$/,
  ],
  '--dist-dir <dir>':
    'output directory to write to when unspecified by targets',
  '--profile': 'enable build profiling',
  '-V, --version': 'output the version number',
  '--detailed-report [depth]': [
    'Print the asset timings and sizes in the build report',
    /^([0-9]+)$/,
  ],
};

var hmrOptions = {
  '--no-hmr': 'disable hot module replacement',
  '-p, --port <port>': [
    'set the port to serve on. defaults to $PORT or 1234',
    value => parseInt(value, 10),
    process.env.PORT || 1234,
  ],
  '--host <host>':
    'set the host to listen on, defaults to listening on all interfaces',
  '--https': 'serves files over HTTPS',
  '--cert <path>': 'path to certificate to use with HTTPS',
  '--key <path>': 'path to private key to use with HTTPS',
};

function applyOptions(cmd, options) {
  for (let opt in options) {
    cmd.option(
      opt,
      ...(Array.isArray(options[opt]) ? options[opt] : [options[opt]]),
    );
  }
}

let serve = program
  .command('serve [input...]')
  .description('starts a development server')
  .option('--public-url <url>', 'the path prefix for absolute urls')
  .option(
    '--open [browser]',
    'automatically open in specified browser, defaults to default browser',
  )
  .option('--watch-for-stdin', 'exit when stdin closes')
  .action(run);

applyOptions(serve, hmrOptions);
applyOptions(serve, commonOptions);

let watch = program
  .command('watch [input...]')
  .description('starts the bundler in watch mode')
  .option('--public-url <url>', 'the path prefix for absolute urls')
  .option('--watch-for-stdin', 'exit when stdin closes')
  .action(run);

applyOptions(watch, hmrOptions);
applyOptions(watch, commonOptions);

let build = program
  .command('build [input...]')
  .description('bundles for production')
  .option('--no-minify', 'disable minification')
  .option('--no-scope-hoist', 'disable scope-hoisting')
  .option('--public-url <url>', 'the path prefix for absolute urls')
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
  INTERNAL_ORIGINAL_CONSOLE.log('');
  INTERNAL_ORIGINAL_CONSOLE.log(
    '  Run `' +
      chalk.bold('parcel help <command>') +
      '` for more information on specific commands',
  );
  INTERNAL_ORIGINAL_CONSOLE.log('');
});

// Make serve the default command except for --help
var args = process.argv;
if (args[2] === '--help' || args[2] === '-h') args[2] = 'help';
if (!args[2] || !program.commands.some(c => c.name() === args[2])) {
  args.splice(2, 0, 'serve');
}

program.parse(args);

async function run(entries: Array<string>, command: any) {
  entries = entries.map(entry => path.resolve(entry));

  if (entries.length === 0) {
    INTERNAL_ORIGINAL_CONSOLE.log('No entries found');
    return;
  }
  let Parcel = require('@parcel/core').default;
  let options = await normalizeOptions(command);
  let packageManager = new NodePackageManager(new NodeFS());
  let defaultConfig: RawParcelConfig = await packageManager.require(
    '@parcel/config-default',
    __filename,
    {autoinstall: options.autoinstall},
  );
  let parcel = new Parcel({
    entries,
    packageManager,
    defaultConfig: {
      ...defaultConfig,
      filePath: (
        await packageManager.resolve('@parcel/config-default', __filename, {
          autoinstall: options.autoinstall,
        })
      ).resolved,
    },
    patchConsole: true,
    ...options,
  });

  if (command.name() === 'watch' || command.name() === 'serve') {
    let {unsubscribe} = await parcel.watch(err => {
      if (err) {
        throw err;
      }
    });

    if (command.open && options.serve) {
      await openInBrowser(
        `${options.serve.https ? 'https' : 'http'}://${options.serve.host ||
          'localhost'}:${options.serve.port}`,
        command.open,
      );
    }

    let isExiting;
    const exit = async () => {
      if (isExiting) {
        return;
      }

      isExiting = true;
      await unsubscribe();
      process.exit();
    };

    if (command.watchForStdin) {
      process.stdin.on('end', async () => {
        INTERNAL_ORIGINAL_CONSOLE.log('STDIN closed, ending');

        await exit();
      });
      process.stdin.resume();
    }

    // Detect the ctrl+c key, and gracefully exit after writing the asset graph to the cache.
    // This is mostly for tools that wrap Parcel as a child process like yarn and npm.
    //
    // Setting raw mode prevents SIGINT from being sent in response to ctrl-c:
    // https://nodejs.org/api/tty.html#tty_readstream_setrawmode_mode
    //
    // We don't use the SIGINT event for this because when run inside yarn, the parent
    // yarn process ends before Parcel and it appears that Parcel has ended while it may still
    // be cleaning up. Handling events from stdin prevents this impression.
    if (process.stdin.isTTY) {
      // $FlowFixMe
      process.stdin.setRawMode(true);
      require('readline').emitKeypressEvents(process.stdin);

      process.stdin.on('keypress', async (char, key) => {
        if (key.ctrl && key.name === 'c') {
          await exit();
        }
      });
    }

    // In non-tty cases, respond to SIGINT by cleaning up.
    process.on('SIGINT', exit);
    process.on('SIGTERM', exit);
  } else {
    try {
      await parcel.run();
    } catch (e) {
      // If an exception is thrown during Parcel.build, it is given to reporters in a
      // buildFailure event, and has been shown to the user.
      if (!(e instanceof BuildError)) {
        await logUncaughtError(e);
      }
      process.exit(1);
    }
  }
}

async function normalizeOptions(command): Promise<InitialParcelOptions> {
  let nodeEnv;
  if (command.name() === 'build') {
    nodeEnv = initialNodeEnv || 'production';
  } else {
    nodeEnv = initialNodeEnv || 'development';
  }

  let https = !!command.https;
  if (command.cert && command.key) {
    https = {
      cert: command.cert,
      key: command.key,
    };
  }

  let serve = false;
  let {port, host} = command;
  if (command.name() === 'serve' || command.hmr) {
    port = await getPort({port, host});

    if (command.port && port !== command.port) {
      // Parcel logger is not set up at this point, so just use native INTERNAL_ORIGINAL_CONSOLE.
      INTERNAL_ORIGINAL_CONSOLE.warn(
        chalk.bold.yellowBright(`⚠️  Port ${command.port} could not be used.`),
      );
    }
  }

  if (command.name() === 'serve') {
    let {publicUrl} = command;

    serve = {
      https,
      port,
      host,
      publicUrl,
    };
  }

  let hmr = null;
  if (command.name() !== 'build' && command.hmr !== false) {
    hmr = {port, host};
  }

  let mode = command.name() === 'build' ? 'production' : 'development';
  return {
    disableCache: command.cache === false,
    cacheDir: command.cacheDir,
    mode,
    minify: command.minify != null ? command.minify : mode === 'production',
    sourceMaps: command.sourceMaps ?? true,
    scopeHoist: command.scopeHoist,
    publicUrl: command.publicUrl,
    distDir: command.distDir,
    hot: hmr,
    contentHash: hmr ? false : command.contentHash,
    serve,
    targets: command.target.length > 0 ? command.target : null,
    autoinstall: command.autoinstall ?? true,
    logLevel: command.logLevel,
    profile: command.profile,
    detailedReport: command.detailedReport,
    env: {
      NODE_ENV: nodeEnv,
    },
  };
}
