import assert from 'assert';
import path from 'path';
import {
  bundle,
  bundler,
  run,
  assertBundles,
  distDir,
  inputFS,
  outputFS,
  overlayFS,
  ncp,
  getNextBuild,
} from '@parcel/test-utils';
import {
  NodePackageManager,
  MockPackageInstaller,
} from '@parcel/package-manager';

describe('postcss', () => {
  it('should build successfully with only postcss-modules config', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-modules-config/index.js'),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['foo.css', 'foo.js', 'index.css', 'index.js'],
      },
      {
        name: 'index.css',
        assets: ['foo.css', 'index.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert(/foo_[0-9a-z]/.test(value));

    let cssClass = value.match(/(foo_[0-9a-z])/)[1];

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes(`.${cssClass}`));
  });

  it('should build successfully with only postcss-modules config in package.json', async () => {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/postcss-modules-config-package/index.js',
      ),
    );

    assertBundles(b, [
      {
        name: 'index.js',
        assets: ['foo.css', 'foo.js', 'index.css', 'index.js'],
      },
      {
        name: 'index.css',
        assets: ['foo.css', 'index.css'],
      },
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert(/foo_[0-9a-z]/.test(value));

    let cssClass = value.match(/(foo_[0-9a-z])/)[1];

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes(`.${cssClass}`));
  });

  it('should support transforming with postcss twice with the same result', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-plugins/index.js'),
    );
    let c = await bundle(
      path.join(__dirname, '/integration/postcss-plugins/index2.js'),
    );

    let [run1, run2] = await Promise.all([run(b), run(c)]);

    assert.equal(run1(), run2());
  });

  it('should support transforming declarations with missing source', async () => {
    await bundle(
      path.join(__dirname, '/integration/postcss-plugins-decl/index.css'),
    );

    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');

    assert(css.includes('url("data:image/gif;base64,quotes")'));
  });

  it('should automatically install postcss plugins if needed', async () => {
    let inputDir = path.join(__dirname, '/input');
    await outputFS.rimraf(inputDir);
    await ncp(
      path.join(__dirname, '/integration/postcss-autoinstall/npm'),
      inputDir,
    );

    let packageInstaller = new MockPackageInstaller();
    packageInstaller.register(
      'postcss-test',
      inputFS,
      path.join(__dirname, '/integration/postcss-autoinstall/postcss-test'),
    );

    // The package manager uses an overlay filesystem, which performs writes to
    // an in-memory fs and reads first from memory, then falling back to the real fs.
    let packageManager = new NodePackageManager(
      overlayFS,
      inputDir,
      packageInstaller,
    );

    let distDir = path.join(outputFS.cwd(), 'dist');

    await bundle(path.join(__dirname, '/input/index.css'), {
      inputFS: overlayFS,
      packageManager,
      shouldAutoInstall: true,
      defaultTargetOptions: {
        distDir,
      },
    });

    // cssnext was installed
    let pkg = JSON.parse(
      await outputFS.readFile(
        path.join(__dirname, '/input/package.json'),
        'utf8',
      ),
    );
    assert(pkg.devDependencies['postcss-test']);

    // postcss-test is applied
    let css = await outputFS.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('background: green'));

    // Increase the timeout for just this test. It takes a while with npm.
    // This method works with arrow functions, and doesn't seem to be documented
    // on the main Mocha docs.
    // https://stackoverflow.com/questions/15971167/how-to-increase-timeout-for-a-single-test-case-in-mocha
  });

  it('should support using postcss for importing', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-import/style.css'),
    );

    assertBundles(b, [
      {
        name: 'style.css',
        assets: ['style.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'style.css'), 'utf8');
    assert.equal(css.split('red').length - 1, 1);
  });

  it('should support using a postcss config in package.json', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-config-package/style.css'),
    );

    assertBundles(b, [
      {
        name: 'style.css',
        assets: ['style.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'style.css'), 'utf8');

    assert(/background-color:\s*red/.test(css));
  });

  it('Should support postcss.config.js config file with PostCSS 7 plugin', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-js-config-7/style.css'),
    );

    assertBundles(b, [
      {
        name: 'style.css',
        assets: ['style.css'],
      },
    ]);

    let css = await outputFS.readFile(path.join(distDir, 'style.css'), 'utf8');
    assert(css.includes('background-color: red;'));
  });

  it('Should support postcss.config.js config file with PostCSS 8 plugin', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-js-config-8/style.css'),
    );

    assertBundles(b, [
      {
        name: 'style.css',
        assets: ['style.css'],
      },
    ]);
  });

  it('should support dir-dependency messages from plugins', async function () {
    let inputDir = path.join(
      __dirname,
      '/input',
      Math.random().toString(36).slice(2),
    );
    await inputFS.mkdirp(inputDir);
    await inputFS.ncp(
      path.join(__dirname, '/integration/postcss-dir-dependency'),
      inputDir,
    );

    let b = await bundler(path.join(inputDir, 'index.css'));

    let subscription = await b.watch();
    let buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');

    let contents = await outputFS.readFile(
      buildEvent.bundleGraph.getBundles()[0].filePath,
      'utf8',
    );
    assert(
      contents.includes(
        'background: linear-gradient(green, pink), linear-gradient(red, orange)',
      ),
    );

    // update
    await inputFS.writeFile(
      path.join(inputDir, 'backgrounds', 'green.txt'),
      'linear-gradient(purple, orange)',
    );

    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');

    contents = await outputFS.readFile(
      buildEvent.bundleGraph.getBundles()[0].filePath,
      'utf8',
    );
    assert(
      contents.includes(
        'background: linear-gradient(purple, orange), linear-gradient(red, orange)',
      ),
    );

    // create
    await inputFS.writeFile(
      path.join(inputDir, 'backgrounds', 'orange.txt'),
      'linear-gradient(orange, purple)',
    );

    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');

    contents = await outputFS.readFile(
      buildEvent.bundleGraph.getBundles()[0].filePath,
      'utf8',
    );
    assert(
      contents.includes(
        'background: linear-gradient(purple, orange), linear-gradient(orange, purple), linear-gradient(red, orange)',
      ),
    );

    // delete
    await inputFS.unlink(path.join(inputDir, 'backgrounds', 'red.txt'));

    buildEvent = await getNextBuild(b);
    assert.equal(buildEvent.type, 'buildSuccess');

    contents = await outputFS.readFile(
      buildEvent.bundleGraph.getBundles()[0].filePath,
      'utf8',
    );
    assert(
      contents.includes(
        'background: linear-gradient(purple, orange), linear-gradient(orange, purple)',
      ),
    );

    await subscription.unsubscribe();
  });

  it('should throw an error with code frame when .postcssrc is invalid', async function () {
    let configFilePath = path.join(
      __dirname,
      '/integration/postcss-modules-config-invalid/.postcssrc',
    );
    let code = await inputFS.readFile(configFilePath, 'utf8');
    await assert.rejects(
      () =>
        bundle(
          path.join(
            __dirname,
            '/integration/postcss-modules-config-invalid/src/index.css',
          ),
        ),
      {
        name: 'BuildError',
        diagnostics: [
          {
            codeFrames: [
              {
                code,
                filePath: configFilePath,
                language: 'json5',
                codeHighlights: [
                  {
                    end: {
                      column: 5,
                      line: 5,
                    },
                    start: {
                      column: 5,
                      line: 5,
                    },
                    message: `JSON5: invalid character '\\"' at 5:5`,
                  },
                ],
              },
            ],
            message: 'Failed to parse .postcssrc',
            origin: '@parcel/utils',
          },
        ],
      },
    );
  });
});
