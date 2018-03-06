const assert = require('assert');
const install = require('../src/utils/installPackage');
const fs = require('fs');
const rimraf = require('rimraf');
const promisify = require('../src/utils/promisify');
const primraf = promisify(rimraf);
const ncp = promisify(require('ncp'));
const inputDirPath = __dirname + '/input';

describe('autoinstall', function() {
  before(async function() {
    // Setup (clear the input dir and move integration test in)
    await primraf(inputDirPath, {});
    await ncp(__dirname + '/integration/babel-default', inputDirPath);
  });

  describe('direct install', function() {
    it('should install lodash using npm', async function() {
      // Run install:
      await install(inputDirPath, ['lodash'], false, true, 'npm');

      /// Assert:
      let pkg = require(inputDirPath + '/package.json');

      assert(pkg.devDependencies['lodash']);
      assert(fs.existsSync('node_modules/lodash'));
    });

    it('should install lodash using yarn', async function() {
      // Run install:
      await install(inputDirPath, ['lodash'], false, true, 'yarn');

      /// Assert:
      let pkg = require(inputDirPath + '/package.json');

      assert(pkg.devDependencies['lodash']);
      assert(fs.existsSync('node_modules/lodash'));

      assert(fs.existsSync('yarn.lock'), 'yarn.lock created');
    });
  });

  after(function() {
    rimraf.sync(inputDirPath);
  });
});
