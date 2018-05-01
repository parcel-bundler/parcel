const assert = require('assert');
const install = require('../src/utils/installPackage');
const fs = require('fs');
const promisify = require('../src/utils/promisify');
const ncp = promisify(require('ncp'));
const {generateTimeKey} = require('./utils');

describe('autoinstall', function() {
  it('should install lodash using npm and save dev dependency to package.json', async function() {
    let inputDir = __dirname + `/input/${generateTimeKey()}`;
    await ncp(__dirname + '/integration/babel-default', inputDir);

    let pkgName = 'lodash';

    await install([pkgName], inputDir + '/test.js', {
      saveDev: true,
      packageManager: 'npm'
    });

    let expectedModulePath = inputDir + '/node_modules/' + pkgName;
    assert(fs.existsSync(expectedModulePath), 'lodash is in node_modules');

    let pkg = fs.readFileSync(inputDir + '/package.json');
    pkg = JSON.parse(pkg);
    assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
  });

  it('should install lodash using yarn and save dev dependency to package.json', async function() {
    let inputDir = __dirname + `/input/${generateTimeKey()}`;
    await ncp(__dirname + '/integration/babel-default', inputDir);

    let pkgName = 'lodash';

    await install([pkgName], inputDir + '/test.js', {
      saveDev: true,
      packageManager: 'yarn'
    });

    let expectedModulePath = inputDir + '/node_modules/' + pkgName;
    assert(fs.existsSync(expectedModulePath), 'lodash is in node_modules');

    let pkg = fs.readFileSync(inputDir + '/package.json');
    pkg = JSON.parse(pkg);
    assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
  });
});
