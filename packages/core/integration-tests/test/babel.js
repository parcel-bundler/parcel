import assert from 'assert';
import path from 'path';
import {
  bundle,
  bundler,
  getNextBuild,
  removeDistDirectory,
  run,
  inputFS as fs,
  outputFS,
  distDir,
  sleep
} from '@parcel/test-utils';
import os from 'os';
import {spawnSync} from 'child_process';
import {symlinkSync} from 'fs';
import tempy from 'tempy';

const parcelCli = require.resolve('parcel/src/bin.js');
const inputDir = path.join(__dirname, '/input');

describe('babel', function() {
  let subscription;
  beforeEach(async function() {
    // TODO maybe don't do this for all tests
    await sleep(100);
    await outputFS.rimraf(inputDir);
    await sleep(100);
  });

  afterEach(async () => {
    await removeDistDirectory();
    if (subscription) {
      await subscription.unsubscribe();
      subscription = null;
    }
  });

  it.skip('should auto install @babel/core v7', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-7-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-7-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-7-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['@babel/core']);
    await fs.writeFile(
      __dirname + '/integration/babel-7-autoinstall/package.json',
      originalPkg
    );
  });

  it.skip('should auto install babel plugins', async function() {
    let originalPkg = await fs.readFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json'
    );
    let b = await bundle(
      __dirname + '/integration/babel-plugin-autoinstall/index.js'
    );

    let output = await run(b);
    assert.equal(typeof output, 'object');
    assert.equal(typeof output.default, 'function');
    assert.equal(output.default(), 3);

    let pkg = await fs.readFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json'
    );
    assert(JSON.parse(pkg).devDependencies['@babel/core']);
    assert(
      JSON.parse(pkg).devDependencies['@babel/plugin-proposal-class-properties']
    );
    await fs.writeFile(
      __dirname + '/integration/babel-plugin-autoinstall/package.json',
      originalPkg
    );
  });

  it('should support compiling with babel using .babelrc config', async function() {
    await bundle(path.join(__dirname, '/integration/babel-custom/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('REPLACE_ME'));
    assert(file.includes('hello there'));
  });

  it('should compile with babel with default engines if no config', async function() {
    await bundle(path.join(__dirname, '/integration/babel-default/index.js'), {
      mode: 'production',
      defaultEngines: null,
      minify: false
    });

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support compiling with babel using browserlist', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-browserslist/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should only include necessary parts of core-js using browserlist', async function() {
    await bundle(path.join(__dirname, '/integration/babel-core-js/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('async function Bar() {}'));
    // Check that core-js's globalThis polyfill is referenced.
    // NOTE: This may change if core-js internals change.
    assert(file.includes('esnext.global-this'));
    assert(!file.includes('es.array.concat'));
  });

  it.skip('should support compiling with babel using browserslist for different environments', async function() {
    async function testBrowserListMultipleEnv(projectBasePath) {
      // Transpiled destructuring, like r = p.prop1, o = p.prop2, a = p.prop3;
      const prodRegExp = /\S+ ?= ?\S+\.prop1,\s*?\S+ ?= ?\S+\.prop2,\s*?\S+ ?= ?\S+\.prop3;/;
      // ES6 Destructuring, like in the source;
      const devRegExp = /const ?{\s*prop1(:.+)?,\s*prop2(:.+)?,\s*prop3(:.+)?\s*} ?= ?.*/;
      let file;
      // Dev build test
      await bundle(path.join(__dirname, projectBasePath, '/index.js'));
      file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert.equal(devRegExp.test(file), true);
      assert.equal(prodRegExp.test(file), false);
      // Prod build test
      await bundle(path.join(__dirname, projectBasePath, '/index.js'), {
        minify: false,
        production: true
      });
      file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert.equal(prodRegExp.test(file), true);
      assert.equal(devRegExp.test(file), false);
    }

    await testBrowserListMultipleEnv(
      '/integration/babel-browserslist-multiple-env'
    );
    await testBrowserListMultipleEnv(
      '/integration/babel-browserslist-multiple-env-as-string'
    );
  });

  it('can build using @babel/preset-env when engines have semver ranges', async () => {
    let fixtureDir = path.join(__dirname, '/integration/babel-semver-engine');
    await bundle(path.join(fixtureDir, 'index.js'));

    let legacy = await outputFS.readFile(
      path.join(fixtureDir, 'dist', 'legacy.js'),
      'utf8'
    );
    assert(legacy.includes('function Foo'));
    assert(legacy.includes('function Bar'));

    let modern = await outputFS.readFile(
      path.join(fixtureDir, 'dist', 'modern.js'),
      'utf8'
    );
    assert(modern.includes('class Foo'));
    assert(modern.includes('class Bar'));
  });

  it('should not compile node_modules by default', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-node-modules/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(/class \S+ \{\}/.test(file));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules with browserslist to app target', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-browserslist/index.js'
      )
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should compile node_modules when symlinked with a source field in package.json', async function() {
    const inputDir = path.join(__dirname, '/input');
    await fs.rimraf(inputDir);
    await fs.mkdirp(path.join(inputDir, 'node_modules'));
    await fs.ncp(
      path.join(path.join(__dirname, '/integration/babel-node-modules-source')),
      inputDir
    );

    // Create the symlink here to prevent cross platform and git issues
    symlinkSync(
      path.join(inputDir, 'packages/foo'),
      path.join(inputDir, 'node_modules/foo'),
      'dir'
    );

    await bundle(inputDir + '/index.js', {outputFS: fs});

    let file = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should not compile node_modules with a source field in package.json when not symlinked', async function() {
    await bundle(
      path.join(
        __dirname,
        '/integration/babel-node-modules-source-unlinked/index.js'
      )
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support compiling JSX', async function() {
    await bundle(path.join(__dirname, '/integration/jsx/index.jsx'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('React.createElement("div"'));
  });

  it('should support compiling JSX in JS files with React dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-react/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('React.createElement("div"'));
  });

  it('should support compiling JSX in JS files with Preact dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-preact/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('h("div"'));
  });

  it('should support compiling JSX in JS files with Nerv dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-nervjs/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('Nerv.createElement("div"'));
  });

  it('should support compiling JSX in JS files with Hyperapp dependency', async function() {
    await bundle(path.join(__dirname, '/integration/jsx-hyperapp/index.js'));

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('h("div"'));
  });

  it('should strip away flow types of node modules', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/babel-strip-flow-types/index.js')
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.equal(output(), 'hello world');

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('OptionsType'));
  });

  it('should support compiling with babel using babel.config.js config', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-config-js/src/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('REPLACE_ME'));
    assert(file.match(/return \d+;/));
  });

  it('should support compiling with babel using babel.config.js config with a require in it', async function() {
    await bundle(
      path.join(__dirname, '/integration/babel-config-js-require/src/index.js')
    );

    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('REPLACE_ME'));
    assert(file.match(/return \d+;/));
  });

  it('should support multitarget builds using a custom babel config with @parcel/babel-preset-env', async function() {
    let fixtureDir = path.join(
      __dirname,
      '/integration/babel-config-js-multitarget'
    );

    await bundle(path.join(fixtureDir, 'src/index.js'));

    let [modern, legacy] = await Promise.all([
      outputFS.readFile(path.join(fixtureDir, 'dist/modern/index.js'), 'utf8'),
      outputFS.readFile(path.join(fixtureDir, 'dist/legacy/index.js'), 'utf8')
    ]);

    assert(modern.includes('class Foo'));
    assert(modern.includes('this.x ** 2'));

    assert(!legacy.includes('class Foo'));
    assert(!legacy.includes('this.x ** 2'));

    await outputFS.rimraf(path.join(fixtureDir, 'dist'));
  });

  it('should support building with default babel config when running parcel globally', async function() {
    let tmpDir = tempy.directory();
    let distDir = path.join(tmpDir, 'dist');
    await fs.ncp(
      path.join(__dirname, '/integration/babel-default'),
      path.join(tmpDir, '/input')
    );
    await bundle(path.join(tmpDir, '/input/index.js'), {
      targets: {
        modern: {
          engines: {
            node: '^4.0.0'
          },
          distDir
        }
      }
    });
    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(file.includes('function Foo'));
    assert(file.includes('function Bar'));
  });

  it('should support building with custom babel config when running parcel globally', async function() {
    let tmpDir = tempy.directory();
    let distDir = path.join(tmpDir, 'dist');
    await fs.ncp(
      path.join(__dirname, '/integration/babel-custom'),
      path.join(tmpDir, '/input')
    );
    await bundle(path.join(tmpDir, '/input/index.js'), {
      targets: {
        modern: {
          engines: {
            node: '^4.0.0'
          },
          distDir
        }
      }
    });
    let file = await outputFS.readFile(path.join(distDir, 'index.js'), 'utf8');
    assert(!file.includes('REPLACE_ME'));
    assert(file.includes('hello there'));
  });

  describe('tests needing the real filesystem', () => {
    beforeEach(async () => {
      await fs.rimraf(inputDir);
      await fs.rimraf(distDir);
    });

    it('should rebuild when .babelrc changes', async function() {
      let differentPath = path.join(inputDir, 'differentConfig');
      let configPath = path.join(inputDir, '.babelrc');

      await fs.ncp(path.join(__dirname, 'integration/babel-custom'), inputDir);

      let b = bundler(path.join(inputDir, 'index.js'), {
        outputFS: fs
      });

      subscription = await b.watch();
      await getNextBuild(b);
      let distFile = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert(distFile.includes('hello there'));
      await fs.copyFile(differentPath, configPath);
      // On Windows only, `fs.utimes` arguments must be instances of `Date`,
      // otherwise it fails. For Mac instances on Azure CI, using a Date instance
      // does not update the utime correctly, so for all other platforms, use a
      // number.
      // https://github.com/nodejs/node/issues/5561
      let now = os.platform() === 'win32' ? new Date() : Date.now();
      // fs.copyFile does not reliably update mtime, which babel uses to invalidate cached file contents
      await fs.utimes(configPath, now, now);
      await getNextBuild(b);
      distFile = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert(!distFile.includes('hello there'));
      assert(distFile.includes('something different'));
    });

    it('should invalidate babel.config.js across runs', async function() {
      let dateRe = /return (\d+);/;

      let fixtureDir = path.join(__dirname, '/integration/babel-config-js');
      let distDir = path.resolve(fixtureDir, './dist');

      let build = () =>
        spawnSync(
          'node',
          [
            parcelCli,
            'build',
            'src/index.js',
            '--no-minify',
            '--no-scope-hoist'
          ],
          {
            cwd: fixtureDir,
            env: {
              ...process.env,
              PARCEL_WORKERS: '0'
            }
          }
        );

      build();
      let file = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert(!file.includes('REPLACE_ME'));
      let firstMatch = file.match(dateRe);
      assert(firstMatch != null);
      let firstDatestamp = firstMatch[1];

      build();
      file = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
      let secondMatch = file.match(dateRe);
      assert(secondMatch != null);
      let secondDatestamp = secondMatch[1];

      assert.notEqual(firstDatestamp, secondDatestamp);
    });

    it('should invalidate when babel plugins are upgraded across runs', async function() {
      let fixtureDir = path.join(
        __dirname,
        '/integration/babel-plugin-upgrade'
      );
      let distDir = path.resolve(inputDir, './dist');
      await fs.ncp(path.join(fixtureDir), inputDir);

      let build = () =>
        spawnSync(
          'node',
          [parcelCli, 'build', 'index.js', '--no-minify', '--no-scope-hoist'],
          {
            cwd: inputDir,
            env: {
              ...process.env,
              PARCEL_WORKERS: '0'
            }
          }
        );

      build();
      let file = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert(!file.includes('REPLACE_ME'));
      assert(file.includes('hello there'));

      await fs.writeFile(
        path.join(inputDir, 'node_modules/babel-plugin-dummy/message.js'),
        'module.exports = "something different"'
      );
      await fs.writeFile(
        path.join(inputDir, 'node_modules/babel-plugin-dummy/package.json'),
        JSON.stringify({name: 'babel-plugin-dummy', version: '1.1.0'})
      );
      await fs.writeFile(
        path.join(inputDir, 'yarn.lock'),
        '# yarn.lock has been updated'
      );

      build();
      file = await fs.readFile(path.join(distDir, 'index.js'), 'utf8');
      assert(!file.includes('REPLACE_ME'));
      assert(!file.includes('hello there'));
      assert(file.includes('something different'));
    });
  });
});
