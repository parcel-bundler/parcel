const assert = require('assert');
const path = require('path');
const fs = require('@parcel/fs');
const {bundle, run, assertBundles, distDir} = require('@parcel/test-utils');

describe('postcss', () => {
  it('should support transforming css modules with postcss', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-modules/index.js')
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: ['index.js', 'foo.module.css']
      },
      {
        name: 'index.css',
        assets: ['index.css', 'foo.module.css']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    assert(/_foo_[0-9a-z]/.test(value));

    let cssClass = value.match(/(_foo_[0-9a-z])/)[1];

    let css = await fs.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes(`.${cssClass}`));
  });

  it('should support transforming with postcss twice with the same result', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-plugins/index.js')
    );
    let c = await bundle(
      path.join(__dirname, '/integration/postcss-plugins/index2.js')
    );

    let [run1, run2] = await Promise.all([run(b), run(c)]);

    assert.equal(run1(), run2());
  });

  it('should support postcss composes imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index.js')
    );

    await assertBundles(b, [
      {
        name: 'index.js',
        assets: [
          'index.js',
          'composes-1.module.css',
          'composes-2.module.css',
          'mixins.module.css'
        ]
      },
      {
        name: 'index.css',
        assets: [
          'composes-1.module.css',
          'composes-2.module.css',
          'mixins.module.css'
        ]
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes1Classes = value.composes1.split(' ');
    const composes2Classes = value.composes2.split(' ');
    assert(composes1Classes[0].startsWith('_composes1_'));
    assert(composes1Classes[1].startsWith('_test_'));
    assert(composes2Classes[0].startsWith('_composes2_'));
    assert(composes2Classes[1].startsWith('_test_'));

    let css = await fs.readFile(path.join(distDir, 'index.css'), 'utf8');
    let cssClass1 = value.composes1.match(/(_composes1_[0-9a-z]+)/)[1];
    assert(css.includes(`.${cssClass1}`));
    let cssClass2 = value.composes2.match(/(_composes2_[0-9a-z]+)/)[1];
    assert(css.includes(`.${cssClass2}`));
  });

  it('should not include css twice for postcss composes imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index.js')
    );

    await run(b);

    let css = await fs.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert.equal(
      css.indexOf('height: 100px;'),
      css.lastIndexOf('height: 100px;')
    );
  });

  it.skip('should support postcss composes imports for sass', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index2.js')
    );

    await assertBundles(b, [
      {
        name: 'index2.js',
        assets: ['index2.js', 'composes-3.css']
      },
      {
        name: 'composes-3.css',
        assets: ['composes-3.css']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes3Classes = value.composes3.split(' ');
    assert(composes3Classes[0].startsWith('_composes3_'));
    assert(composes3Classes[1].startsWith('_test_'));

    let css = await fs.readFile(path.join(distDir, 'composes-3.css'), 'utf8');
    assert(css.includes('height: 200px;'));
  });

  it('should support postcss composes imports with custom path names', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index3.js')
    );

    await assertBundles(b, [
      {
        name: 'index3.js',
        assets: ['index3.js', 'composes-4.module.css', 'mixins.module.css']
      },
      {
        name: 'index3.css',
        assets: ['composes-4.module.css', 'mixins.module.css']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes4Classes = value.composes4.split(' ');
    assert(composes4Classes[0].startsWith('_composes4_'));
    assert(composes4Classes[1].startsWith('_test_'));

    let css = await fs.readFile(path.join(distDir, 'index3.css'), 'utf8');
    assert(css.includes('height: 100px;'));
  });

  it('should support deep nested postcss composes imports', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index4.js')
    );

    await assertBundles(b, [
      {
        name: 'index4.js',
        assets: [
          'index4.js',
          'composes-5.module.css',
          'mixins-intermediate.module.css',
          'mixins.module.css'
        ]
      },
      {
        name: 'index4.css',
        assets: [
          'composes-5.module.css',
          'mixins-intermediate.module.css',
          'mixins.module.css'
        ]
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes5Classes = value.composes5.split(' ');
    assert(composes5Classes[0].startsWith('_composes5_'));
    assert(composes5Classes[1].startsWith('_intermediate_'));
    assert(composes5Classes[2].startsWith('_test_'));

    let css = await fs.readFile(path.join(distDir, 'index4.css'), 'utf8');
    assert(css.includes('height: 100px;'));
    assert(css.includes('height: 300px;'));
    assert(css.indexOf('._test_') < css.indexOf('._intermediate_'));
  });

  it('should support postcss composes imports for multiple selectors', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/postcss-composes/index5.js')
    );

    await assertBundles(b, [
      {
        name: 'index5.js',
        assets: ['index5.js', 'composes-6.module.css', 'mixins.module.css']
      },
      {
        name: 'index5.css',
        assets: ['composes-6.module.css', 'mixins.module.css']
      }
    ]);

    let output = await run(b);
    assert.equal(typeof output, 'function');

    let value = output();
    const composes6Classes = value.composes6.split(' ');
    assert(composes6Classes[0].startsWith('_composes6_'));
    assert(composes6Classes[1].startsWith('_test_'));
    assert(composes6Classes[2].startsWith('_test-2_'));
  });

  it('should automatically install postcss plugins with npm if needed', async () => {
    await fs.rimraf(path.join(__dirname, '/input'));
    await fs.ncp(
      path.join(__dirname, '/integration/postcss-autoinstall/npm'),
      path.join(__dirname, '/input')
    );
    await bundle(path.join(__dirname, '/input/index.css'));

    // cssnext was installed
    let pkg = require('./input/package.json');
    assert(pkg.devDependencies['postcss-cssnext']);

    // peer dependency caniuse-lite was installed
    assert(pkg.devDependencies['caniuse-lite']);

    // cssnext is applied
    let css = await fs.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('rgba'));

    // Increase the timeout for just this test. It takes a while with npm.
    // This method works with arrow functions, and doesn't seem to be documented
    // on the main Mocha docs.
    // https://stackoverflow.com/questions/15971167/how-to-increase-timeout-for-a-single-test-case-in-mocha
  }).timeout(150000);

  it('should automatically install postcss plugins with yarn if needed', async () => {
    await fs.rimraf(path.join(__dirname, '/input'));
    await fs.ncp(
      path.join(__dirname, '/integration/postcss-autoinstall/yarn'),
      path.join(__dirname, '/input')
    );
    await bundle(path.join(__dirname, '/input/index.css'));

    // cssnext was installed
    let pkg = require('./input/package.json');
    assert(pkg.devDependencies['postcss-cssnext']);

    // peer dependency caniuse-lite was installed
    assert(pkg.devDependencies['caniuse-lite']);

    // appveyor is not currently writing to the yarn.lock file and will require further investigation
    // let lockfile = await fs.readFile(path.join(__dirname, '/input/yarn.lock'), 'utf8');
    // assert(lockfile.includes('postcss-cssnext'));

    // cssnext is applied
    let css = await fs.readFile(path.join(distDir, 'index.css'), 'utf8');
    assert(css.includes('rgba'));
  });
});
