/**
 * Copyright (c) Facebook, Inc. and its affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @flow
 * Note: cannot use prettier here because this file is ran as-is
 */

/**
 * script to build (transpile) files.
 * By default it transpiles all files for all packages and writes them
 * into `build/` directory.
 * Non-js or files matching IGNORE_PATTERN will be copied without transpiling.
 *
 * Example:
 *  node ./scripts/build.js
 *  node ./scripts/build.js /user/c/metro/packages/metro-abc/src/abc.js
 */

'use strict';

const babel = require('@babel/core');
const chalk = require('chalk');
const fs = require('fs');
const getPackages = require('./_getPackages');
const glob = require('glob');
const micromatch = require('micromatch');
const mkdirp = require('mkdirp');
const path = require('path');

const envPresets = {
  legacy: require('@parcel/babel-preset/legacy'),
  modern: require('@parcel/babel-preset/modern')
};

const SRC_DIR = 'src';
const BUILD_DIR = 'lib';
const JS_FILES_PATTERN = '**/*.js';
const IGNORE_PATTERN = '**/__tests__/**';
const PACKAGES_DIR = path.resolve(__dirname, '../../..');

const fixedWidth = function(str /*: string*/) {
  const WIDTH = 80;
  const strs = str.match(new RegExp(`(.{1,${WIDTH}})`, 'g')) || [str];
  let lastString = strs[strs.length - 1];
  if (lastString.length < WIDTH) {
    lastString += Array(WIDTH - lastString.length).join(chalk.dim('.'));
  }
  return strs
    .slice(0, -1)
    .concat(lastString)
    .join('\n');
};

function getPackageName(file) {
  return path
    .relative(PACKAGES_DIR, file)
    .split(path.sep)
    .slice(0, 2)
    .join(path.sep);
}

function getBuildPath(file, buildFolder, env) {
  const pkgName = getPackageName(file);
  const pkgSrcPath = path.resolve(PACKAGES_DIR, pkgName, SRC_DIR);
  const pkgBuildPath =
    path.resolve(PACKAGES_DIR, pkgName, buildFolder) + '/' + env;
  const relativeToSrcPath = path.relative(pkgSrcPath, file);
  return path.resolve(pkgBuildPath, relativeToSrcPath);
}

function buildPackage(p, {env}) {
  const srcDir = path.resolve(p, SRC_DIR);
  const pattern = path.resolve(srcDir, '**/*');
  const files = glob.sync(pattern, {nodir: true});
  const name = getPackageName(path.resolve(p, 'index'));

  process.stdout.write(fixedWidth(`${name}\n`));

  files.forEach(file => buildFile(file, {env, silent: true}));
  process.stdout.write(`[  ${chalk.green('OK')}  ]\n`);
}

function buildFile(file, {env, silent}) {
  const destPath = getBuildPath(file, BUILD_DIR, env);

  mkdirp.sync(path.dirname(destPath));
  if (micromatch.isMatch(file, IGNORE_PATTERN)) {
    silent ||
      process.stdout.write(
        chalk.dim('  \u2022 ') +
          path.relative(PACKAGES_DIR, file) +
          ' (ignore)\n'
      );
  } else if (!micromatch.isMatch(file, JS_FILES_PATTERN)) {
    fs.createReadStream(file).pipe(fs.createWriteStream(destPath));
    silent ||
      process.stdout.write(
        chalk.red('  \u2022 ') +
          path.relative(PACKAGES_DIR, file) +
          chalk.red(' \u21D2 ') +
          path.relative(PACKAGES_DIR, destPath) +
          ' (copy)' +
          '\n'
      );
  } else {
    // $FlowFixMe TODO t25179342 need to update flow-types for babel-core
    const transformed = babel.transformFileSync(file, {
      presets: [envPresets[env]]
    }).code;
    fs.writeFileSync(destPath, transformed);
    const source = fs.readFileSync(file).toString('utf-8');
    if (/\@flow/.test(source)) {
      fs.createReadStream(file).pipe(fs.createWriteStream(destPath + '.flow'));
    }
    silent ||
      process.stdout.write(
        chalk.green('  \u2022 ') +
          path.relative(PACKAGES_DIR, file) +
          chalk.green(' \u21D2 ') +
          path.relative(PACKAGES_DIR, destPath) +
          '\n'
      );
  }
}

const files = process.argv.slice(2);

if (files.length) {
  // $FlowFixMe
  files.forEach(buildFile);
} else {
  // $FlowFixMe TODO t25179342 Add version to the flow types for this module
  process.stdout.write(
    chalk.bold.inverse('Building legacy build') +
      ' (using Babel v' +
      babel.version +
      ')\n'
  );
  getPackages().forEach(p => buildPackage(p, {env: 'legacy'}));
  process.stdout.write(
    chalk.bold.inverse('Building modern build') +
      ' (using Babel v' +
      babel.version +
      ')\n'
  );
  getPackages().forEach(p => buildPackage(p, {env: 'modern'}));
  process.stdout.write('\n');
}
