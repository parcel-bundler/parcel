const assert = require('assert');
const install = require('../src/utils/installPackage');
const fs = require('../src/utils/fs');
const {ncp, rimraf} = require('./utils');
const path = require('path');
const inputDirPath = path.join(__dirname, '/input');

describe('autoinstall', function() {
  beforeEach(async function() {
    // Setup (clear the input dir and move integration test in)
    await rimraf(inputDirPath, {});
    await ncp(path.join(__dirname, '/integration/babel-default'), inputDirPath);
  });

  it('should install lodash using npm and save dev dependency to package.json', async function() {
    let pkgName = 'lodash';

    await install([pkgName], inputDirPath + '/test.js', {
      saveDev: true,
      packageManager: 'npm'
    });

    let expectedModulePath = inputDirPath + '/node_modules/' + pkgName;
    assert(await fs.exists(expectedModulePath), 'lodash is in node_modules');

    let pkg = await fs.readFile(inputDirPath + '/package.json');
    pkg = JSON.parse(pkg);
    assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
  });

  it('should install lodash using yarn and save dev dependency to package.json', async function() {
    let pkgName = 'lodash';

    await install([pkgName], inputDirPath + '/test.js', {
      saveDev: true,
      packageManager: 'yarn'
    });

    let expectedModulePath = inputDirPath + '/node_modules/' + pkgName;
    assert(await fs.exists(expectedModulePath), 'lodash is in node_modules');

    let pkg = await fs.readFile(inputDirPath + '/package.json');
    pkg = JSON.parse(pkg);
    assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
  });

  afterEach(async function() {
    await rimraf(inputDirPath);
  });
});
