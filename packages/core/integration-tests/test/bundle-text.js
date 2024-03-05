import assert from 'assert';
import path from 'path';
import {assertBundles, bundle, run} from '@parcel/test-utils';
import vm from 'vm';

describe('bundle-text:', function () {
  it("should inline a bundle's compiled text with `bundle-text`", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.js'),
    );

    let cssBundleContent = (await run(b)).default;

    assert(
      cssBundleContent.startsWith(
        `body {
  background-color: #000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}`,
      ),
    );

    assert(!cssBundleContent.includes('sourceMappingURL'));
  });

  it('should not include the runtime manifest for `bundle-text`', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.js'),
      {
        mode: 'production',
        defaultTargetOptions: {shouldScopeHoist: false, shouldOptimize: false},
      },
    );

    assertBundles(b, [
      {
        name: 'index.js',
        type: 'js',
        assets: ['esmodule-helpers.js', 'index.js'],
      },
      {
        type: 'svg',
        assets: ['img.svg'],
      },
      {
        type: 'css',
        assets: ['text.scss'],
      },
    ]);

    let cssBundleContent = (await run(b)).default;

    assert(
      cssBundleContent.startsWith(
        `body {
  background-color: #000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}`,
      ),
    );

    assert(!cssBundleContent.includes('sourceMappingURL'));
  });

  it("should inline an HTML bundle's compiled text with `bundle-text`", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/index.html'),
    );

    let res = await run(b);
    assert.equal(res.default, '<p>test</p>\n');
  });

  it('should inline an HTML bundle and inline scripts with `bundle-text`', async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/inline.js'),
    );

    let res = await run(b);
    assert.equal(
      res.default,
      `<p>test</p>\n<script>console.log("hi");\n\n</script>\n`,
    );
  });

  it("should inline a JS bundle's compiled text with `bundle-text` and HMR enabled", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/javascript.js'),
      {
        hmrOptions: {},
      },
    );

    let res = await run(b);
    let log;
    let ctx = vm.createContext({
      console: {
        log(x) {
          log = x;
        },
      },
    });
    vm.runInContext(res.default, ctx);
    assert.equal(log, 'hi');
  });

  it("should inline a JS bundle's compiled text with `bundle-text` with symbol propagation", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/javascript.js'),
      {
        mode: 'production',
      },
    );

    let res = await run(b);
    let log;
    let ctx = vm.createContext({
      console: {
        log(x) {
          log = x;
        },
      },
    });
    vm.runInContext(res, ctx);
    assert.equal(log, 'hi');
  });

  it("should inline a bundle's compiled text with `bundle-text` asynchronously", async () => {
    let b = await bundle(
      path.join(__dirname, '/integration/bundle-text/async.js'),
    );

    let promise = (await run(b)).default;
    assert.equal(typeof promise.then, 'function');

    let cssBundleContent = await promise;

    assert(
      cssBundleContent.startsWith(
        `body {
  background-color: #000;
}

.svg-img {
  background-image: url("data:image/svg+xml,%3Csvg%3E%0A%0A%3C%2Fsvg%3E%0A");
}`,
      ),
    );

    assert(!cssBundleContent.includes('sourceMappingURL'));
  });
});
