#!/usr/bin/env node

const assert = require('assert');
const babel = require('@babel/core');
const fs = require('fs');
const glob = require('fast-glob');
const path = require('path');

const {shouldReplace, getReplacementName} = require('./utils');

const CORE_PACKAGENAME = '@parcel/core';
const coreVersion = require('../../core/core/package.json').version;

const jsFiles = glob.sync('packages/*/*/lib/**/*.js', {
  absolute: true,
  cwd: path.resolve(__dirname, '../../..'),
});

for (const filePath of jsFiles) {
  const transformed = babel.transformFileSync(filePath, {
    babelrc: false,
    configFile: false,
    plugins: [
      [
        'babel-plugin-module-resolver',
        {
          alias: {
            '^@parcel/(.*)': ([packageName, matched]) =>
              shouldReplace(packageName)
                ? '@atlassian/parcel-' + matched
                : packageName,
          },
        },
      ],
      require('./babel-plugin-replace-package-references'),
    ],
  });

  fs.writeFileSync(filePath, transformed.code);
}

const packageJsons = glob.sync('packages/*/*/package.json', {
  absolute: true,
  cwd: path.resolve(__dirname, '../../..'),
});

for (const filePath of packageJsons) {
  const contents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (typeof contents.name === 'string') {
    if (contents.name === 'parcel') {
      contents.name = '@atlassian/parcel';
    } else if (shouldReplace(contents.name)) {
      contents.name = getReplacementName(contents.name);
    }
  }

  for (const depMap of [contents.dependencies, contents.devDependencies]) {
    if (typeof depMap !== 'object' || depMap == null) {
      continue;
    }

    for (const [pkg, ver] of Object.entries(depMap)) {
      if (shouldReplace(pkg)) {
        delete depMap[pkg];
        depMap[getReplacementName(pkg)] = ver;
      }
    }
  }

  if (
    typeof contents.peerDependencies === 'object' &&
    contents.peerDependencies != null &&
    contents.peerDependencies[CORE_PACKAGENAME] != null
  ) {
    // Lerna doesn't update peerDependencies automatically. Update core's ourselves, and rename it.
    delete contents.peerDependencies[CORE_PACKAGENAME];
    contents.peerDependencies[getReplacementName(CORE_PACKAGENAME)] =
      '^' + coreVersion;
  }

  fs.writeFileSync(filePath, JSON.stringify(contents, null, 2));
}

const configPackageJsons = glob.sync('packages/configs/*/package.json', {
  absolute: true,
  cwd: path.resolve(__dirname, '../../..'),
});

for (const filePath of configPackageJsons) {
  const packageJsonContents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const main = packageJsonContents.main;
  assert(typeof main === 'string');

  const configPath = path.resolve(path.dirname(filePath), main);
  const configContents = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(
    configPath,
    configContents.replace(/@parcel\//g, '@atlassian/parcel-'),
  );
}
