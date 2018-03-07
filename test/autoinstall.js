const assert = require('assert');
const install = require('../src/utils/installPackage');
const fs = require('fs');
const rimraf = require('rimraf');
const promisify = require('../src/utils/promisify');
const primraf = promisify(rimraf);
const ncp = promisify(require('ncp'));
const inputDirPath = __dirname + '/input';

describe('autoinstall', function() {
  beforeEach(async function() {
    // Setup (clear the input dir and move integration test in)
    await primraf(inputDirPath, {});
    await ncp(__dirname + '/integration/babel-default', inputDirPath);
  });

  describe('direct install', function() {
    it('should install lodash using npm', async function() {
      let pkgName = 'lodash';

      // Run install:
      await install({
        dir: inputDirPath,
        modules: [pkgName],
        saveDev: true,
        packageManager: 'npm'
      });

      /// Assert:
      assert(
        fs.existsSync(
          inputDirPath + '/node_modules/' + pkgName,
          'lodash is installed after running install()'
        )
      );

      let pkg = fs.readFileSync(inputDirPath + '/package.json');
      pkg = JSON.parse(pkg);

      assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
    });

    it('should install lodash using yarn', async function() {
      let pkgName = 'lodash';

      // Run install:
      await install({
        dir: inputDirPath,
        modules: [pkgName],
        saveDev: true,
        packageManager: 'yarn'
      });

      /// Assert:
      assert(
        fs.existsSync(
          inputDirPath + '/node_modules/' + pkgName,
          'lodash is installed after running install()'
        )
      );

      let pkg = fs.readFileSync(inputDirPath + '/package.json');
      pkg = JSON.parse(pkg);

      assert(pkg.devDependencies[pkgName], 'lodash is saved as a dev dep');
    });
  });

  afterEach(function() {
    rimraf.sync(inputDirPath);
  });
});
