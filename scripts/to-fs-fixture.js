#! /usr/bin/env node
/* eslint-disable no-console */

require('@parcel/babel-register');

const fs = require('node:fs').promises;
const path = require('node:path');
const {spawn, execSync} = require('node:child_process');

/* eslint-disable import/no-extraneous-dependencies */
const commander = require('commander');
const inquirer = require('inquirer');
const chalk = require('chalk');
const diff = require('diff');
const nullthrows = require('nullthrows');

const {toFixture} = require('@parcel/test-utils/src/fsFixture');
const {isGlobMatch} = require('@parcel/utils/src/glob');
/* eslint-enable import/no-extraneous-dependencies */

/**
 * Some fixture dirs are organized in nested dirs, e.g.:
 *   integration/
 *     scope-hoisting/
 *       commonjs/
 *         fixture-dir/
 *
 * Keeping a list of these dirnames gives us a better chance of
 * identifying the fixture files without including extraneous files.
 */
const POSSIBLE_ROOTS = ['commonjs', 'es6', 'integration'];

/**
 * A reciprocal pattern to `POSSIBLE_ROOTS` that is used
 * to rewrite fixture paths to match the new fs-fixture path.
 */
const ROOT_PATTERN =
  /(\/)?integration(?:\/scope-hoisting\/(?:(?:commonjs)|(?:es6)))?\//;

/** Where integration test fixtures are found */
const FIXTURE_PATH = path.resolve(
  __dirname,
  '../packages/core/integration-tests/test',
);

/** Where to insert the `overlayFS` argument for various test utils. */
const TEST_UTIL_ARITY = {
  ncp: 3,
  assertESMExports: 5,
};

/** A simple promisified exec(). */
function execAsync(cmd) {
  return new Promise((resolve, reject) => {
    let child = spawn(cmd, {
      stdio: 'inherit',
      shell: true,
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Exit code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

/** Pretty print a test fixture filepath. */
function printPath(filePath) {
  let root = path.resolve(
    path.join(__dirname, '../packages/core/integration-tests/test'),
  );
  return chalk.blue(
    path.relative(
      root,
      filePath.startsWith(root) ? filePath : path.join(root, filePath),
    ),
  );
}

/** Pretty print a code location. */
function printLoc(loc) {
  return chalk.dim(`${loc.start.line}:${loc.start.column}`);
}

/** Asserts that the given node is a test call expression. */
function assertIsTest(file, test, api) {
  let j = api.jscodeshift;

  let it = test.find(j.CallExpression, {callee: {name: 'it'}});

  if (it.length === 0) {
    let loc = test.get('loc').value;
    throw new Error(
      `Expected an it() call at ${file.path}:${loc.start.line}:${loc.start.column}`,
    );
  }
}

/** Asserts that the given test is an async function declaration. */
function assertIsAsyncTest(file, test, api) {
  let j = api.jscodeshift;

  assertIsTest(file, test, api);

  let fn = test
    .find(j.CallExpression, {callee: {name: 'it'}})
    .get('arguments', 1).value;

  if (
    (fn.type !== 'FunctionExpression' &&
      fn.type !== 'ArrowFunctionExpression') ||
    !fn.async
  ) {
    throw new Error(
      `Expected an async function at ${file.path}:${fn.loc.start.line}:${fn.loc.start.column}`,
    );
  }
}

/** Gets the test name as it might be presented by mocha. */
function getTestName(test, api) {
  let j = api.jscodeshift;
  let it = test
    .find(j.CallExpression, {callee: {name: 'it'}})
    .get('arguments', 0).value.value;

  let desc = [it];

  let describe = test.closest(j.CallExpression, {callee: {name: 'describe'}});
  while (describe.length > 0) {
    desc.unshift(describe.get('arguments', 0).value.value);
    describe = describe.closest(j.CallExpression, {callee: {name: 'describe'}});
  }

  return desc.join(' ');
}

/**
 * Find tests that contain fixture paths that contain `integration/`.
 * See `findFixturePaths` for more details.
 */
function findTestsWithFixturePaths(root, api, options) {
  const j = api.jscodeshift;

  let testMap = new Map();
  root
    .find(j.ExpressionStatement, {expression: {callee: {name: 'it'}}})
    .forEach(p => {
      let test = j(p);
      let fixturePaths = findFixturePaths(test, api, options);
      if (
        fixturePaths.literals.length > 0 ||
        fixturePaths.templates.length > 0
      ) {
        testMap.set(test, fixturePaths);
      }
    });

  return testMap;
}

/** Checks if the given fixture path matches any of the 'keep' globs. */
function shouldKeepFixture(fixturePath, keep) {
  if (keep == null) return false;
  if (!Array.isArray(keep)) keep = [keep];
  if (keep?.length) {
    for (let glob of keep) {
      if (isGlobMatch(fixturePath, glob, {bash: true})) {
        return true;
      }
    }
  }
  return false;
}

/** Checks if the given test name matches any of the 'grep' patterns. */
function shouldTransformTest(testName, grep) {
  if (grep == null) return true;
  if (!Array.isArray(grep)) grep = [grep];
  if (grep?.length) {
    for (let pattern of grep) {
      if (new RegExp(pattern).test(testName)) {
        return true;
      }
    }
  }
}

/**
 * Find fixture paths that contain `integration/`.
 *
 * Things we could find:
 *
 *   '/integration/...'
 *   __dirname + '/integration/...'
 *   path.join(__dirname, '/integration/...')
 *   `${__dirname}/integration/...`
 */
function findFixturePaths(test, api, {verbose, keep}) {
  let j = api.jscodeshift;
  return {
    literals: test.find(j.Literal).filter(p => {
      let {value, loc} = p.value;
      if (value?.includes?.('integration/')) {
        if (shouldKeepFixture(value, keep)) {
          if (verbose) {
            console.log(
              chalk.yellow(
                `Skipping fixture path ${printPath(value)} at ${printLoc(
                  loc,
                )} because it matches a keep glob.`,
              ),
            );
          }
          return false;
        }

        if (verbose) {
          console.log(
            chalk.dim(
              `Found fixture path ${printPath(p.value.value)} at ${printLoc(
                loc,
              )}`,
            ),
          );
        }
        return true;
      }
      return false;
    }),
    templates: test.find(j.TemplateElement).filter(p => {
      let {value, loc} = p.value;
      if (value?.cooked?.includes?.('integration/')) {
        if (shouldKeepFixture(value.cooked, keep)) {
          if (verbose) {
            console.log(
              chalk.yellow(
                `Skipping fixture path ${printPath(value.cooked)} at ${printLoc(
                  loc,
                )} because it matches a keep glob.`,
              ),
            );
          }
          return false;
        }

        if (verbose) {
          console.log(
            chalk.dim(
              `Found fixture path ${printPath(value.cooked)} at ${printLoc(
                loc,
              )}`,
            ),
          );
        }
        return true;
      }
      return false;
    }),
  };
}

/** Resolve a fixture path from a test to an absolute filepath. */
function resolveFixturePath(value) {
  let filePath = value;
  let dirname = path.dirname(filePath);
  while (POSSIBLE_ROOTS.every(root => path.basename(dirname) !== root)) {
    if (filePath === dirname) {
      throw new Error(
        `Could not find one of ${POSSIBLE_ROOTS} in path: ${value}`,
      );
    }
    filePath = dirname;
    dirname = path.dirname(filePath);
  }

  filePath = path.resolve(path.join(FIXTURE_PATH, filePath));
  return filePath;
}

/**
 * Given a set of nodes that specify fixture paths,
 * generates a map of fixture paths to the `fsFixture`
 * template string equivalents for the files in those paths.
 */
async function generateFsFixtures(fixturePaths, api, {verbose}) {
  let toGenerate = [];

  fixturePaths.literals.forEach(match => {
    toGenerate.push(resolveFixturePath(match.get('value').value));
  });

  fixturePaths.templates.forEach(match => {
    toGenerate.push(resolveFixturePath(match.get('value').value.cooked));
  });

  let fixtures = new Map();
  for (let filePath of toGenerate) {
    if (!fixtures.has(filePath)) {
      try {
        fixtures.set(filePath, await toFixture(fs, filePath, true));
      } catch (e) {
        if (e.code === 'ENOENT') {
          if (verbose) {
            console.log(
              chalk.yellow(
                `Skipping missing fixture path: ${printPath(filePath)}`,
              ),
            );
          }
          continue;
        } else if (e.message.startsWith('Disallowed')) {
          if (verbose) {
            console.log(
              chalk.yellow(
                `Skipping fixture path with disallowed filetypes: ${printPath(
                  filePath,
                )}`,
              ),
            );
          }
          continue;
        } else if (e.message.startsWith('File too large')) {
          if (verbose) {
            console.log(
              chalk.yellow(
                `Skipping fixture path with large file(s): ${printPath(
                  filePath,
                )}`,
              ),
            );
          }
          continue;
        }
        throw e;
      }
    }
  }

  return fixtures;
}

/** Print a diff of the test before and after the transform. */
async function printDiff(testName, testString, api, options) {
  let j = api.jscodeshift;
  let test = j(testString);
  // Suppress redundant verbose output while generating the diff.
  let opts = {...options, verbose: false};
  let fixturePaths = findFixturePaths(test, api, opts);
  let fixtures = await generateFsFixtures(fixturePaths, api, opts);
  if (fixtures.size) {
    insertFsFixtures(test, fixtures, api, opts);
    replaceInputFS(test, api, opts);
    replaceFixturePaths(fixturePaths, api, opts);
    console.log(
      diff
        .createTwoFilesPatch('before', 'after', testString, test.toSource())
        .split('\n')
        .map(line => {
          if (/^\++ /.test(line)) {
            return chalk.green(line);
          } else if (/^-+ /.test(line)) {
            return chalk.red(line);
          } else if (/^@+ /.test(line)) {
            return chalk.black(line);
          }
          return line;
        })
        .join('\n'),
    );
  }
}

/**
 * Replaces the fixture paths in the test with the paths
 * used in the generated `fsFixture` template string.
 */
function replaceFixturePaths(fixturePaths, api) {
  let j = api.jscodeshift;

  for (let match of fixturePaths.literals.paths().map(p => j(p))) {
    match.replaceWith(p => p.value.raw.replace(ROOT_PATTERN, '$1'));
  }

  for (let match of fixturePaths.templates.paths().map(p => j(p))) {
    // TODO: Update the path. this probably isn't the right way?
    match.replaceWith(p => p.value.value.cooked.replace(ROOT_PATTERN, '$1'));
  }
}

/**
 * Where possible, specifies `overlayFS` as the input fs for the test.
 *
 * For example, in a test that uses the `bundle` test util, the options
 * to the `bundle` call will be updated to use `overlayFS` as the input fs,
 * unless already specified.
 * */
function replaceInputFS(test, {jscodeshift: j}, {verbose}) {
  let shouldReplace = false;
  test.find(j.CallExpression).forEach(node => {
    let {loc, arguments: args, callee} = node.value;
    let name = callee?.name;
    switch (name) {
      case 'bundle':
      case 'bundler': {
        let options = args[1];
        if (options) {
          if (options.type === 'Identifier') {
            args[1] = j.objectExpression([
              j.property(
                'init',
                j.identifier('inputFS'),
                j.identifier('overlayFS'),
              ),
              j.spreadElement(options),
            ]);
            if (verbose) {
              console.log(
                chalk.dim(
                  `Adding ${chalk.yellow(
                    'inputFS: overlayFS',
                  )} option arg to ${chalk.yellow(name)} call at ${printLoc(
                    loc,
                  )}`,
                ),
              );
            }
          } else {
            if (options.type !== 'ObjectExpression') {
              throw new Error(
                `Expected options to be an object, but saw ${options.type}`,
              );
            }
            let inputFS = options.properties.find(
              prop => prop.key.name === 'inputFS',
            );
            if (!inputFS) {
              shouldReplace = true;
              options.properties.push(
                j.property(
                  'init',
                  j.identifier('inputFS'),
                  j.identifier('overlayFS'),
                ),
              );
              if (verbose) {
                console.log(
                  chalk.dim(
                    `Adding ${chalk.yellow(
                      'inputFS: overlayFS',
                    )} option to ${chalk.yellow(name)} call at ${printLoc(
                      loc,
                    )}`,
                  ),
                );
              }
            } else if (verbose) {
              console.log(
                chalk.yellow(
                  `Skipping ${name} call at ${printLoc(
                    loc,
                  )} because it already had an inputFS option.`,
                ),
              );
            }
          }
        } else {
          shouldReplace = true;
          args[1] = j.objectExpression([
            j.property(
              'init',
              j.identifier('inputFS'),
              j.identifier('overlayFS'),
            ),
          ]);
          if (verbose) {
            console.log(
              chalk.dim(
                `Adding ${chalk.yellow(
                  'inputFS: overlayFS',
                )} option arg to ${chalk.yellow(name)} call at ${printLoc(
                  loc,
                )}`,
              ),
            );
          }
        }
        break;
      }
      case 'assertESMExports':
      case 'ncp': {
        let arity = nullthrows(TEST_UTIL_ARITY[name]);
        if (arity != null && args.length < arity) {
          while (args.length < arity - 1) {
            args.push(j.literal(null));
          }
          args.push(j.identifier('overlayFS'));
          if (verbose) {
            console.log(
              chalk.dim(
                `Adding ${chalk.yellow('overlayFS')} argument to ${chalk.yellow(
                  name,
                )} call at ${printLoc(loc)}`,
              ),
            );
          }
        } else if (verbose) {
          console.log(
            chalk.yellow(
              `Skipping ${name} call at ${printLoc(
                loc,
              )} because it already has an fs argument.`,
            ),
          );
        }
        break;
      }
    }
  });

  if (shouldReplace) {
    test.find(j.Identifier, {name: 'inputFS'}).forEach(path => {
      if (path.parentPath.value.type === 'Property') return;
      if (verbose) {
        console.log(
          chalk.dim(
            `Replacing ${chalk.yellow('inputFS')} with ${chalk.yellow(
              'overlayFS',
            )} at ${printLoc(path.value.loc)}`,
          ),
        );
      }
      path.value.name = 'overlayFS';
    });
  }
}

/** Adds imports for `fsFixture` and `overlayFS`. */
function insertFsFixtureImport(root, api) {
  let j = api.jscodeshift;
  // Insert import for fsFixture
  let testUtils = root.find(j.ImportDeclaration, {
    source: {value: '@parcel/test-utils'},
  });

  if (testUtils.length === 0) {
    root.find(j.ImportDeclaration).at(-1).insertAfter(`
        import {fsFixture, overlayFS} from '@parcel/test-utils';
      `);
  } else {
    let specifiers = testUtils.find(j.Specifier);
    if (!specifiers.paths().some(p => p.value.imported.name === 'fsFixture')) {
      specifiers
        .at(-1)
        .insertAfter(j.importSpecifier(j.identifier('fsFixture')));
    }
    if (!specifiers.paths().some(p => p.value.imported.name === 'overlayFS')) {
      specifiers
        .at(-1)
        .insertAfter(j.importSpecifier(j.identifier('overlayFS')));
    }
  }
}

/** Prints the `fsFixture` template string. */
function printFsFixture(fixtures) {
  return `await fsFixture(overlayFS, __dirname)\`\n${[...fixtures.values()]
    .map(fixture =>
      fixture
        .toString()
        .trim()
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n'),
    )
    .join('\n')}\`;`;
}

/** Adds fsFixture declaration expressions to the test. */
function insertFsFixtures(test, fixtures, api) {
  let j = api.jscodeshift;
  let firstBodyNode = test
    .find(j.CallExpression, {callee: {name: 'it'}})
    .find(j.BlockStatement)
    .get('body', 0);
  firstBodyNode.insertBefore(printFsFixture(fixtures));
}

/** Prompts the user to transform a test. Noop if `yes` is true. */
async function promptToTransformFixtures(testName, {yes}) {
  if (yes) return true;
  let {result} = await inquirer.prompt({
    type: 'expand',
    name: 'result',
    message: `Transform ${chalk.blue(testName)}`,
    default: 0,
    choices: [
      {key: 'y', name: 'transform this test', value: true},
      {key: 'n', name: 'do not transform this test', value: false},
      {key: 'a', name: 'transform remaining tests in the file', value: 'all'},
      {key: 'd', name: 'skip remaining tests in the file', value: 'none'},
      {key: 'v', name: 'view the diff for this test', value: 'view'},
    ],
  });
  return result;
}

/**
 * Finds all tests that use fs fixtures and converts them to use fsFixture.
 *
 * This is the transform that jscodeshift will run on each file.
 */
async function transform(file, api, options) {
  const j = api.jscodeshift;
  const root = j(file.source);

  // Manage a local copy of options so we can modify it iteratively.
  let opts = {...options, dryRun: options.dryRun ?? options.dry};
  let hasTransformedFixtures = false;

  // Manage a stack of tests so we can interactively transform them,
  // e.g., view the diff, then decide to transform or not.
  let tests = [...findTestsWithFixturePaths(root, api, opts)].reverse();

  let printedDiff = new Set();
  outer: while (tests.length) {
    let [test, fixturePaths] = tests.pop();
    let testName = getTestName(test, api);

    if (!shouldTransformTest(testName, opts.grep)) {
      if (opts.verbose) {
        console.log(
          chalk.yellow(
            `Skipping ${chalk.blue(
              testName,
            )} because it does not match grep patterns.`,
          ),
        );
      }
      continue;
    }

    assertIsAsyncTest(file, test, api);

    if (opts.verbose && (!opts.yes || opts.dryRun) && !printedDiff.has(test)) {
      await printDiff(testName, test.toSource(), api, opts);
    }
    printedDiff.add(test);

    switch (await promptToTransformFixtures(testName, opts)) {
      case true: {
        let fixtures = await generateFsFixtures(fixturePaths, api, opts);
        if (fixtures.size) {
          insertFsFixtures(test, fixtures, api, opts);
          replaceInputFS(test, api, opts);
          replaceFixturePaths(fixturePaths, api, opts);

          hasTransformedFixtures = true;

          // Report converted fixture filePaths for cleanup.
          for (let fixturePath of fixtures.keys()) {
            process.send?.({type: 'fixture', filePath: file.path, fixturePath});
          }

          // Also report the test scope so we know which tests need to be run.
          process.send?.({type: 'test', filePath: file.path, testName});
        }
        break;
      }
      case 'all': {
        opts.yes = true;
        tests.push([test, fixturePaths]);
        break;
      }
      case 'none': {
        break outer;
      }
      case 'view': {
        await printDiff(testName, test.toSource(), api, opts);
        tests.push([test, fixturePaths]);
        break;
      }
    }
  }

  if (hasTransformedFixtures) {
    insertFsFixtureImport(root, api, options);
    // Only return something if we changed something.
    return root.toSource();
  }
}

module.exports = transform;
module.exports.parser = 'flow';

/**
 * Runs jscodeshift to apply `transform` to `file`.
 * Collects the results of the transform and resolves to them when complete.
 */
function runJsCodeshift(file, {dryRun, verbose, yes, keep, grep}) {
  return new Promise((resolve, reject) => {
    let results = {
      /** A set of fixture paths that were converted. */
      fixturesToCleanup: new Set(),
      /** A set of test names that were modified. */
      testsToVerify: new Set(),
    };

    let args = ['--run-in-band', '--parser=flow'];
    if (dryRun) args.push('--dry');
    if (verbose) args.push('--verbose=2');
    if (yes) args.push('--yes');
    if (keep?.length) args = args.concat(keep.map(k => `--keep "${k}"`));
    if (grep?.length) args = args.concat(grep.map(g => `--grep "${g}"`));
    args.push(`--transform=${__filename}`);
    args = args.concat(file);

    if (verbose) {
      console.log(chalk.dim(`jscodeshift ${args.join(' ')}`));
    }

    const jscodeshift = spawn('jscodeshift', args, {
      env: {FORCE_COLOR: 'true', ...process.env},
      stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
      shell: true,
    });

    jscodeshift.on('message', event => {
      switch (event.type) {
        case 'fixture': {
          results.fixturesToCleanup.add(event.fixturePath);
          break;
        }
        case 'test': {
          results.testsToVerify.add(event.testName);
          break;
        }
        default: {
          console.error(`Unknown event type: ${event.type}`);
        }
      }
    });

    jscodeshift.on('close', code => {
      if (code !== 0) {
        reject(new Error(`Exit code ${code}`));
      } else {
        resolve(results);
      }
    });
  });
}

/** Cleans up old fixtures that were replaced by the transform. */
async function cleanupFixtures(fixturesToCleanup, {cleanup, dryRun, verbose}) {
  if (!cleanup || fixturesToCleanup.size === 0) {
    return;
  }

  console.log(
    chalk.yellow(`Cleaning up ${fixturesToCleanup.size} fixtures...`),
  );

  for (let fixture of fixturesToCleanup) {
    if (dryRun) {
      console.log(chalk.green(`Would remove ${printPath(fixture)}`));
      continue;
    }

    if (verbose) {
      console.log(chalk.red(`Removing ${printPath(fixture)}`));
    }

    try {
      await fs.rm(fixture, {recursive: true});
    } catch (err) {
      console.error(err);
    }
  }
}

/** Reports the results of the transforms. */
function reportResults({fixturesToCleanup, testsToVerify}, options) {
  if (fixturesToCleanup.size && !options.cleanup) {
    console.log(
      chalk.yellow(
        `\nThe following fixtures would've been removed with --cleanup:`,
      ),
    );
    for (let fixture of fixturesToCleanup) {
      console.log(chalk.yellow(`  ${printPath(fixture)}`));
    }
  }

  if (testsToVerify.size === 0) {
    console.log(
      chalk.green(`\nNo tests were modified. No need to verify any tests.`),
    );
    return;
  }

  for (let [filename, tests] of testsToVerify) {
    console.log(
      chalk.green(
        `\nPlease verify that ${chalk.blue(filename)} still passes all tests.`,
      ),
    );
    if (options.verbose) {
      if (options.dryRun) {
        console.log(chalk.dim(`Tests that would've been modified:`));
      } else {
        console.log(chalk.dim(`Tests that were modified:`));
      }
      for (let test of tests) {
        console.log(chalk.dim(`  ${test}`));
      }
    }
  }
}

/** Bootstraps jscodeshift and runs the transform. */
function bootstrap(files, {parent: options}) {
  let cmd = 'npx --package jscodeshift';

  let npxVersion = execSync('npx -v');
  if (parseInt(npxVersion.toString().split('.').shift(), 10) > 6) {
    cmd = `${cmd} --yes`;
  }

  // Bootstrap jscodeshift and rerun this script as a jscodeshift transform.
  let args = ['run'];
  if (options.cleanup) args.push('--cleanup');
  if (options.dryRun) args.push('--dry-run');
  if (options.verbose) args.push('--verbose');
  if (options.yes) args.push('--yes');
  if (options.keep) args = args.concat(options.keep.map(k => `--keep "${k}"`));
  if (options.grep) args = args.concat(options.grep.map(g => `--grep "${g}"`));
  args.push('--');
  args = args.concat(files);
  args = args.join(' ');

  if (options.verbose) {
    console.log(chalk.dim(`${cmd} -c '${__filename} ${args}'`));
  }
  return execAsync(`${cmd} -c '${__filename} ${args}'`);
}

/** Runs the transform and optionally cleans up and verifies the results. */
async function run(files, {parent: options}) {
  let opts = {
    cleanup: Boolean(options.cleanup),
    dryRun: Boolean(options.dryRun),
    keep: options.keep,
    grep: options.grep,
    verbose: Boolean(options.verbose) || Boolean(options.dryRun),
    yes: Boolean(options.yes),
  };

  let fixturesToCleanup = new Set();
  let testsToVerify = new Map();

  for (let file of files) {
    let results = await runJsCodeshift(file, opts);
    for (let fixture of results.fixturesToCleanup) {
      fixturesToCleanup.add(fixture);
    }
    testsToVerify.set(file, results.testsToVerify);
  }

  await cleanupFixtures(fixturesToCleanup, opts);
  reportResults({fixturesToCleanup, testsToVerify}, opts);
}

if (require.main === module) {
  let program = new commander.Command();
  program
    .arguments('<files...>')
    .usage('[options] <files...>')
    .description('Convert test files to use fsFixture.', {
      files: 'One or more files to be transformed in-place. Required.',
    })
    .option('--cleanup', 'Cleanup old fixtures after running')
    .option('--dry-run', 'Dry run (implies --verbose)')
    .option(
      '--grep <pattern>',
      'Only transform tests matching this pattern. Can be repeated.',
      (v, a) => a.concat(v),
      [],
    )
    .option(
      '--keep <glob>',
      'Keep fixtures matching glob. Can be repeated.',
      (v, a) => a.concat(v),
      [],
    )
    .option('--verbose', 'Verbose output')
    .option('--yes', 'Say yes to all prompts');

  program.command('bootstrap <files...>', {noHelp: true}).action(bootstrap);
  program.command('run <files...>', {noHelp: true}).action(run);

  let args = process.argv;
  if (!args.includes('--help') && !args.includes('-h')) {
    if (!args[2] || !program.commands.some(c => c.name() === args[2])) {
      args.splice(2, 0, 'bootstrap');
    }
  }

  program.parse(args);
}
