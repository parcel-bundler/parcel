#!/usr/bin/env node

const assert = require('assert');
const babel = require('@babel/core');
const fs = require('fs');
const glob = require('fast-glob');
const path = require('path');

const {shouldReplace, getReplacementName} = require('./utils');

const jsFiles = glob.sync('packages/*/*/lib/**.js', {
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
            '^@parcel/(.*)': x =>
              x[1] === 'watcher'
                ? '@parcel/watcher'
                : '@atlassian/parcel-' + x[1],
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

    for (const [key, val] of Object.entries(depMap)) {
      if (shouldReplace(key)) {
        delete depMap[key];
        depMap[getReplacementName(key)] = val;
      }
    }
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
