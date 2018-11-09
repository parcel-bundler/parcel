const path = require('path');
const fs = require('@parcel/fs');
const assert = require('assert');
const {rimraf, ncp, packageInstall} = require('./utils');
const {mkdirp} = require('@parcel/fs');
const {bundle, run} = require('./utils');

const rootDir = path.join(__dirname, 'input/yarn-workspace');
const entryPoint = path.join(rootDir, 'packages/package-main/source.ts');
const outFile = path.join(rootDir, 'packages/package-main/source.js');

describe('yarn-workspace', function() {
  before(async function() {
    await rimraf(path.join(__dirname, '/input'));
    await mkdirp(rootDir);
    await ncp(path.join(__dirname, 'integration/yarn-workspace'), rootDir);
    await packageInstall(rootDir);
    const b = await bundle(entryPoint, {
      rootDir,
      outDir: path.dirname(outFile)
    });
    await run(b);
  });

  after(async function() {
    await rimraf(path.join(__dirname, '/input'));
  });

  describe('package-a', function() {
    it('should install babel with `yarn add` (not `npm install`)', async function() {
      let packageLockFileExist = await fs.exists(
        path.join(rootDir, 'packages/package-a/package-lock.json')
      );
      assert(!packageLockFileExist);
    });
  });

  describe('package-b', function() {
    it('should remove comments when compiled, since it is extending definition from the root', async function() {
      let js = await fs.readFile(outFile, 'utf8');
      assert(!js.includes('/* test comment */'));
    });
    it('should not require to install `typescript` as a devDependency', async function() {
      const pkg = await fs.readFile(
        path.join(rootDir, 'packages/package-a/package.json')
      );
      assert(!JSON.parse(pkg).devDependencies['typescript']);
    });
  });
});
