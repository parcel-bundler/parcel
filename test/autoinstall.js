const assert = require('assert');
const install = require('../src/utils/installPackage');
const fs = require('fs');
const {removeDirectory, tmpPath} = require('./utils');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));

describe('autoinstall', function() {
  beforeEach(async function() {
    // Setup (clear the input dir and move integration test in)
    await removeDirectory(tmpPath('input'));
    await ncp(__dirname + '/integration/babel-default', tmpPath('input'));
  });

  it('should install lodash using npm and save dev dependency to package.json', async function() {
    let pkgName = 'lodash';

    await install([pkgName], tmpPath('input', 'test.js'), {
      saveDev: true,
      packageManager: 'npm'
    });

    let expectedModulePath = tmpPath('input', 'node_modules', pkgName);
    assert(fs.existsSync(expectedModulePath), 'lodash is in node_modules');

    let pkg = fs.readFileSync(tmpPath('input', 'package.json'));
    pkg = JSON.parse(pkg);
    assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
  });

  it('should install lodash using yarn and save dev dependency to package.json', async function() {
    let pkgName = 'lodash';

    await install([pkgName], tmpPath('input', 'test.js'), {
      saveDev: true,
      packageManager: 'yarn'
    });

    let expectedModulePath = tmpPath('input', 'node_modules', pkgName);
    assert(fs.existsSync(expectedModulePath), 'lodash is in node_modules');

    let pkg = fs.readFileSync(tmpPath('input', 'package.json'));
    pkg = JSON.parse(pkg);
    assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
  });

  afterEach(async function() {
    await removeDirectory(tmpPath('input'));
  });
});
