// @flow strict-local

import program from 'commander';
// flowlint-next-line untyped-import:off
import {name, version} from '../package.json';
// flowlint-next-line untyped-import:off
import simpleGit from 'simple-git';
import fs from 'fs';
import path from 'path';
import _ncp from 'ncp';
import {promisify} from 'util';
import commandExists from 'command-exists';
// flowlint-next-line untyped-import:off
import spawn from '@npmcli/promise-spawn';
import _rimraf from 'rimraf';
import tempy from 'tempy';

const TEMPLATES_DIR = path.resolve(__dirname, '../templates');

const ncp = promisify(_ncp);
const rimraf = promisify(_rimraf);
// eslint-disable-next-line no-console
const log = console.log;

// flowlint-next-line untyped-import:off
require('v8-compile-cache');

program.name(name).version(version);
program.action((command: string | typeof program) => {
  if (typeof command !== 'string') {
    command.help();
    return;
  }

  run(command).catch(reason => {
    // eslint-disable-next-line no-console
    console.error(reason.message);
    process.exit(1);
  });
});

program.parse(process.argv);

async function run(packagePath: string) {
  log('running path', packagePath);
  if (await fsExists(packagePath)) {
    throw new Error(`Package at ${packagePath} already exists`);
  }

  let tempPath = tempy.directory();
  try {
    await createApp(path.basename(packagePath), tempPath);
  } catch (e) {
    await rimraf(tempPath);
    throw e;
  }

  await fs.promises.rename(tempPath, packagePath);

  // Print instructions
  log(`Run ${usesYarn ? 'yarn' : 'npm run'} start`);
}

async function createApp(packageName: string, tempPath: string) {
  // Initialize repo
  const git = simpleGit({baseDir: tempPath});
  log('Initializing git repository...');
  await git.init();

  // Copy templates
  log('Copying templates...');
  async function writePackageJson() {
    const packageJson = JSON.parse(
      await fs.promises.readFile(
        path.join(TEMPLATES_DIR, 'package.json'),
        'utf8',
      ),
    );
    await fs.promises.writeFile(
      path.join(tempPath, 'package.json'),
      JSON.stringify(
        {
          name: path.basename(tempPath),
          ...packageJson,
        },
        null,
        2,
      ),
    );
  }

  await Promise.all([
    writePackageJson(),
    ncp(path.join(TEMPLATES_DIR, 'default'), tempPath),
  ]);

  // Install packages
  log('Installing packages...');
  await installPackages(['parcel@nightly'], {
    cwd: tempPath,
    isDevDependency: true,
  });
  await installPackages(['react', 'react-dom'], {cwd: tempPath});

  // Initial commit
  log('Creating initial commit...');
  await git.add('.');
  await git.commit('Initial commit created with @parcel/create-react-app');
}

async function fsExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)) && true;
  } catch {
    return false;
  }
}

let usesYarn;
async function installPackages(
  packageExpressions: Array<string>,
  opts: {|
    cwd: string,
    isDevDependency?: boolean,
  |},
): Promise<void> {
  if (usesYarn == null) {
    usesYarn = await commandExists('yarn');
    if (!(await commandExists('npm'))) {
      throw new Error('Neither npm nor yarn found on system');
    }
  }

  if (usesYarn) {
    return spawn(
      'yarn',
      [
        'add',
        opts.isDevDependency ? '--dev' : null,
        ...packageExpressions,
      ].filter(Boolean),
      {cwd: opts.cwd, stdio: 'inherit'},
    );
  }

  return spawn(
    'npm',
    [
      'install',
      opts.isDevDependency ? '--save-dev' : null,
      ...packageExpressions,
    ].filter(Boolean),
    {cwd: opts.cwd, stdio: 'inherit'},
  );
}
