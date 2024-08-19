// @flow strict-local

import type {ProgramOptions} from '@atlaspack/link';

import {createProgram as _createProgram} from '@atlaspack/link';
import {describe, fsFixture, it, overlayFS} from '@atlaspack/test-utils';

import assert from 'assert';
import path from 'path';
import sinon from 'sinon';

function createProgram(opts: ProgramOptions) {
  let program = _createProgram(opts).exitOverride();

  function cli(command: string = ''): Promise<void> {
    return program.parseAsync(command.split(/\s+/), {from: 'user'});
  }

  return cli;
}

// This test suite has been broken since the rename but it's not obvious why.
// Parking for later.
describe.v2('@atlaspack/link', () => {
  let _cwd;
  let _stdout;

  beforeEach(async function () {
    await overlayFS.mkdirp('/app');
    overlayFS.chdir('/app');

    // $FlowFixMe[incompatible-call]
    _cwd = sinon.stub(process, 'cwd').callsFake(() => overlayFS.cwd());
    _stdout = sinon.stub(process.stdout, 'write');
  });

  afterEach(function () {
    _cwd?.restore();
    _stdout?.restore();
    _cwd = null;
    _stdout = null;
  });

  it('prints help text', async () => {
    let cli = createProgram({fs: overlayFS});
    await assert.throws(() => cli('--help'), /\(outputHelp\)/);
  });

  it('links by default', async () => {
    let link = sinon.stub();
    let cli = createProgram({fs: overlayFS, link});
    await cli();
    assert(link.called);
  });

  describe('link', () => {
    it('errors for invalid app root', async () => {
      let cli = createProgram({fs: overlayFS});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('link'), /Not a project root/);
    });

    it('errors for invalid package root', async () => {
      await fsFixture(overlayFS)`yarn.lock:`;

      assert(overlayFS.existsSync('/app/yarn.lock'));

      let cli = createProgram({fs: overlayFS});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('link /fake'), /Not a package root/);
    });

    it('errors when a link exists', async () => {
      await fsFixture(overlayFS)`yarn.lock:`;

      let cli = createProgram({fs: overlayFS});
      await cli(`link`);

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('link'), /link already exists/);
    });

    it('links with the default options', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        node_modules
          atlaspack
          @atlaspack/core`;

      let cli = createProgram({fs: overlayFS});
      await cli('link');

      assert(overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.realpathSync('node_modules/@atlaspack/core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/atlaspack'),
        path.resolve(__dirname, '../../atlaspack'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/.bin/atlaspack'),
        path.resolve(__dirname, '../../atlaspack/src/bin.js'),
      );
    });

    it('links from a custom package root', async () => {
      await fsFixture(overlayFS, '/')`
        app
          yarn.lock:
          node_modules
            atlaspack
            @atlaspack/core
        package-root
          core
            core/package.json: ${{name: '@atlaspack/core'}}
            atlaspack
              package.json: ${{name: 'atlaspack'}}
              src/bin.js:`;

      overlayFS.chdir('/app');

      let cli = createProgram({fs: overlayFS});
      await cli(`link ../package-root`);

      assert(overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.realpathSync('node_modules/@atlaspack/core'),
        path.resolve(overlayFS.cwd(), '../package-root/core/core'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/atlaspack'),
        path.resolve(overlayFS.cwd(), '../package-root/core/atlaspack'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/.bin/atlaspack'),
        path.resolve(
          overlayFS.cwd(),
          '../package-root/core/atlaspack/src/bin.js',
        ),
      );
    });

    it('links with a custom namespace', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        node_modules
          .bin/atlaspack:
          @namespace
            atlaspack
            atlaspack-core`;

      let cli = createProgram({fs: overlayFS});
      await cli('link --namespace @namespace');

      assert(overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.realpathSync('node_modules/.bin/atlaspack'),
        path.resolve(__dirname, '../../atlaspack/src/bin.js'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/@namespace/atlaspack-core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/@atlaspack/core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/@namespace/atlaspack'),
        path.resolve(__dirname, '../../atlaspack'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/atlaspack'),
        path.resolve(__dirname, '../../atlaspack'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/.bin/atlaspack'),
        path.resolve(__dirname, '../../atlaspack/src/bin.js'),
      );
    });

    // FIXME: this test fails on windows
    it.skip('updates config for custom namespace', async () => {
      await fsFixture(overlayFS, '/')`
        ${path.resolve(
          path.join(__dirname, '../../../configs/namespace/package.json'),
        )}: ${{
        name: '@atlaspack/config-namespace',
      }}
        app
          yarn.lock:
          .atlaspackrc: ${{
            extends: '@namespace/atlaspack-config-namespace',
            transformers: {
              '*': [
                '@namespace/atlaspack-transformer-js',
                '@namespace/atlaspack-transformer-local',
              ],
            },
          }}
          package.json: ${{
            ['@namespace/atlaspack-transformer-js']: {},
            ['@namespace/atlaspack-transformer-local']: {},
          }}`;

      overlayFS.chdir('/app');

      let cli = createProgram({fs: overlayFS});
      await cli('link --namespace @namespace');

      assert(overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.readFileSync('.atlaspackrc', 'utf8'),
        JSON.stringify({
          extends: '@atlaspack/config-namespace',
          transformers: {
            '*': [
              '@atlaspack/transformer-js',
              '@namespace/atlaspack-transformer-local',
            ],
          },
        }),
      );

      assert.equal(
        overlayFS.readFileSync('package.json', 'utf8'),
        JSON.stringify({
          ['@atlaspack/transformer-js']: {},
          ['@namespace/atlaspack-transformer-local']: {},
        }),
      );
    });

    it('links with custom node modules glob', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        tools
          test/node_modules/atlaspack
          test2/node_modules/@atlaspack/core`;

      let cli = createProgram({fs: overlayFS});
      await cli('link --node-modules-glob "tools/*/node_modules"');

      assert(overlayFS.existsSync('.atlaspack-link'));

      assert(overlayFS.existsSync('tools/test/node_modules'));
      assert(!overlayFS.existsSync('tools/test/node_modules/atlaspack'));

      assert(overlayFS.existsSync('tools/test2/node_modules'));
      assert(!overlayFS.existsSync('tools/test2/node_modules/@atlaspack/core'));

      assert.equal(
        overlayFS.realpathSync('node_modules/atlaspack'),
        path.resolve(__dirname, '../../atlaspack'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/.bin/atlaspack'),
        path.resolve(__dirname, '../../atlaspack/src/bin.js'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/@atlaspack/core'),
        path.resolve(__dirname, '../../core'),
      );
    });

    it('does not do anything with dry run', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        node_modules
          atlaspack
          @atlaspack/core`;

      let cli = createProgram({fs: overlayFS});
      await cli('link --dry-run');

      assert(!overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.realpathSync('node_modules/@atlaspack/core'),
        path.resolve('/app/node_modules/@atlaspack/core'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/atlaspack'),
        path.resolve('/app/node_modules/atlaspack'),
      );

      assert(!overlayFS.existsSync('node_modules/.bin/atlaspack'));
    });
  });

  describe('unlink', () => {
    it('errors without a link config', async () => {
      await fsFixture(overlayFS)`yarn.lock:`;

      let cli = createProgram({fs: overlayFS});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('unlink'), /link could not be found/);
    });

    it('errors for invalid app root', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        .atlaspack-link: ${{
          appRoot: '/app2',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@atlaspack',
        }}`;

      let cli = createProgram({fs: overlayFS});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('unlink'), /Not a project root/);
    });

    it('errors for invalid package root', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..') + '2',
          nodeModulesGlobs: ['node_modules'],
          namespace: '@atlaspack',
        }}`;

      let cli = createProgram({fs: overlayFS});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('unlink'), /Not a package root/);
    });

    it('unlinks with the default options', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        node_modules
          .bin/atlaspack -> ${path.resolve(
            __dirname,
            '../../atlaspack/src/bin.js',
          )}
          atlaspack -> ${path.resolve(__dirname, '../../atlaspack')}
          @atlaspack/core -> ${path.resolve(__dirname, '../../core')}
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@atlaspack',
        }}`;

      assert(overlayFS.existsSync('.atlaspack-link'));
      assert(overlayFS.existsSync('node_modules/@atlaspack/core'));
      assert(overlayFS.existsSync('node_modules/atlaspack'));
      assert(overlayFS.existsSync('node_modules/.bin/atlaspack'));

      let cli = createProgram({fs: overlayFS});
      await cli('unlink');

      assert(!overlayFS.existsSync('.atlaspack-link'));
      assert(!overlayFS.existsSync('node_modules/@atlaspack/core'));
      assert(!overlayFS.existsSync('node_modules/atlaspack'));
      assert(!overlayFS.existsSync('node_modules/.bin/atlaspack'));
    });

    it('unlinks from a custom package root', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: '/package-root',
          nodeModulesGlobs: ['node_modules'],
          namespace: '@atlaspack',
        }}
        node_modules/atlaspack -> package-root/core/atlaspack
        node_modules/@atlaspack/core -> package-root/core/core
        node_modules/.bin/atlaspack -> package-root/core/atlaspack/src/bin.js`;

      await fsFixture(overlayFS, '/')`
        package-root/core/core/package.json: ${{name: '@atlaspack/core'}}
        package-root/core/atlaspack/package.json: ${{name: 'atlaspack'}}
        package-root/core/atlaspack/src/bin.js:`;

      let cli = createProgram({fs: overlayFS});
      await cli('unlink');

      assert(!overlayFS.existsSync('.atlaspack-link'));
      assert(!overlayFS.existsSync('node_modules/@atlaspack/core'));
      assert(!overlayFS.existsSync('node_modules/atlaspack'));
      assert(!overlayFS.existsSync('node_modules/.bin/atlaspack'));
    });

    it('unlinks with a custom namespace', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@namespace',
        }}
        node_modules
          .bin/atlaspack -> ${path.resolve(
            __dirname,
            '../../atlaspack/src/bin.js',
          )}
          atlaspack -> ${path.resolve(__dirname, '../../atlaspack')}
          @namespace/atlaspack -> ${path.resolve(__dirname, '../../atlaspack')}
          atlaspack/core -> ${path.resolve(__dirname, '../../core')}
          @namespace/atlaspack-core -> ${path.resolve(
            __dirname,
            '../../core',
          )}`;

      let cli = createProgram({fs: overlayFS});
      await cli('unlink');

      assert(!overlayFS.existsSync('.atlaspack-link'));
      assert(!overlayFS.existsSync('node_modules/@atlaspack/core'));
      assert(!overlayFS.existsSync('node_modules/atlaspack'));
      assert(!overlayFS.existsSync('node_modules/.bin/atlaspack'));
      assert(!overlayFS.existsSync('node_modules/@namespace/atlaspack-core'));
      assert(!overlayFS.existsSync('node_modules/@namespace/atlaspack'));
    });

    // FIXME: this test fails on windows
    it.skip('updates config for custom namespace', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        .atlaspackrc: ${{
          extends: '@atlaspack/config-namespace',
          transformers: {
            '*': [
              '@atlaspack/transformer-js',
              '@namespace/atlaspack-transformer-local',
            ],
          },
        }}
        package.json: ${{
          ['@atlaspack/transformer-js']: {},
          ['@namespace/atlaspack-transformer-local']: {},
        }}
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@namespace',
        }}`;

      await fsFixture(overlayFS, '/')`
        ${path.resolve(
          path.join(__dirname, '../../../configs/namespace/package.json'),
        )}: ${{
        name: '@atlaspack/config-namespace',
      }}`;

      let cli = createProgram({fs: overlayFS});
      await cli('unlink');

      assert(!overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.readFileSync('.atlaspackrc', 'utf8'),
        JSON.stringify({
          extends: '@namespace/atlaspack-config-namespace',
          transformers: {
            '*': [
              '@namespace/atlaspack-transformer-js',
              '@namespace/atlaspack-transformer-local',
            ],
          },
        }),
      );

      assert.equal(
        overlayFS.readFileSync('package.json', 'utf8'),
        JSON.stringify({
          ['@namespace/atlaspack-transformer-js']: {},
          ['@namespace/atlaspack-transformer-local']: {},
        }),
      );
    });

    it('unlinks with custom node modules glob', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules', 'tools/*/node_modules'],
          namespace: '@atlaspack',
        }}
        node_modules
          atlaspack -> ${path.resolve(__dirname, '../../atlaspack')}
          @atlaspack/core -> ${path.resolve(__dirname, '../../core')}
          .bin/atlaspack -> ${path.resolve(
            __dirname,
            '../../atlaspack/src/bin.js',
          )}
        tools
          test/node_modules/atlaspack -> ${path.resolve(
            __dirname,
            '../../atlaspack',
          )}
          test2/node_modules/@atlaspack/core -> ${path.resolve(
            __dirname,
            '../../core',
          )}`;

      let cli = createProgram({fs: overlayFS});
      await cli('unlink');

      assert(!overlayFS.existsSync('.atlaspack-link'));
      assert(!overlayFS.existsSync('node_modules/@atlaspack/core'));
      assert(!overlayFS.existsSync('node_modules/atlaspack'));
      assert(!overlayFS.existsSync('node_modules/.bin/atlaspack'));
      assert(!overlayFS.existsSync('tools/test/node_modules/atlaspack'));
      assert(!overlayFS.existsSync('tools/test2/node_modules/@atlaspack/core'));
    });

    it('does not do anything with dry run', async () => {
      await fsFixture(overlayFS)`
        yarn.lock:
        node_modules
          .bin/atlaspack -> ${path.resolve(
            __dirname,
            '../../atlaspack/src/bin.js',
          )}
          atlaspack -> ${path.resolve(__dirname, '../../atlaspack')}
          @atlaspack/core -> ${path.resolve(__dirname, '../../core')}
        .atlaspack-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@atlaspack',
        }}
      `;

      let cli = createProgram({fs: overlayFS});
      await cli('unlink --dry-run');

      assert(overlayFS.existsSync('.atlaspack-link'));

      assert.equal(
        overlayFS.realpathSync('node_modules/@atlaspack/core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/atlaspack'),
        path.resolve(__dirname, '../../atlaspack'),
      );

      assert.equal(
        overlayFS.realpathSync('node_modules/.bin/atlaspack'),
        path.resolve(__dirname, '../../atlaspack/src/bin.js'),
      );
    });
  });
});
