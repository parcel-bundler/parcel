// @flow strict-local

import program from 'commander';
// flowlint-next-line untyped-import:off
import {name, version} from '../package.json';
import mkdirp from 'mkdirp';
// flowlint-next-line untyped-import:off
import simpleGit from 'simple-git';
import fs from 'fs';

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

  // Create directory
  log('Creating package directory...');
  await mkdirp(packagePath);

  // Initialize repo
  const git = simpleGit({baseDir: packagePath});
  log('Initializing git repository...');
  await git.init();

  // Copy templates
  // Install packages
  // Print instructions
}

async function fsExists(filePath: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(filePath)) && true;
  } catch {
    return false;
  }
}

function log(...args: Array<mixed>): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}
