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
  .option('--open', 'automatically open in default browser')
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
  .option(
    '-t, --target [target]',
    'set the runtime environment, either "node", "browser" or "electron". defaults to "browser"',
    /^(node|browser|electron)$/
  )
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
  .option(
    '-t, --target [target]',
    'set the runtime environment, either "node", "browser" or "electron". defaults to "browser"',
    /^(node|browser|electron)$/
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
  .option(
    '-t, --target <target>',
    'set the runtime environment, either "node", "browser" or "electron". defaults to "browser"',
    /^(node|browser|electron)$/
  )
  .option(
    '--detailed-report',
    'print a detailed build report after a completed build'
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

// Make serve the default command
var args = process.argv;
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

  const bundler = new Bundler(main, command);

  if (command.name() === 'serve') {
    const server = await bundler.serve(command.port || 1234, command.https);
    if (command.open) {
      require('opn')(
        `${command.https ? 'https' : 'http'}://localhost:${
          server.address().port
        }`
      );
    }
  } else {
    bundler.bundle();
  }
}
