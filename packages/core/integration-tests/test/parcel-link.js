// @flow strict-local

import type {ProgramOptions} from '@parcel/link';

import {createProgram as _createProgram} from '@parcel/link';
import {workerFarm, inputFS, fsFixture} from '@parcel/test-utils';
import {OverlayFS} from '@parcel/fs';

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

function callableProxy(target, handler) {
  // $FlowFixMe[unclear-type]
  return new Proxy<any>(handler, {
    get(_, prop) {
      let value = Reflect.get(target, prop);
      if (typeof value === 'function') {
        return value.bind(target);
      }
      return value;
    },
  });
}

describe('@parcel/link', () => {
  let _cwd;
  let _stdout;

  declare function createFS(
    strings: Array<string>, // $FlowFixMe[unclear-type]
    ...exprs: Array<any>
  ): Promise<OverlayFS>;

  // eslint-disable-next-line no-redeclare
  declare function createFS(cwd?: string): Promise<OverlayFS> &
    ((
      strings: Array<string>, // $FlowFixMe[unclear-type]
      ...values: Array<any>
    ) => Promise<OverlayFS>);

  // eslint-disable-next-line no-redeclare
  function createFS(cwdOrStrings = '/', ...exprs) {
    assert(_cwd == null, 'FS already exists!');

    let fs = new OverlayFS(workerFarm, inputFS);

    // $FlowFixMe[incompatible-call]
    _cwd = sinon.stub(process, 'cwd').callsFake(() => fs.cwd());

    if (Array.isArray(cwdOrStrings)) {
      let cwd = path.resolve(path.sep);
      return fs.mkdirp(cwd).then(async () => {
        fs.chdir(cwd);
        await fsFixture(fs, cwd)(cwdOrStrings, ...exprs);
        return fs;
      });
    } else {
      let cwd = path.resolve(cwdOrStrings);
      let promise = fs.mkdirp(cwd).then(() => {
        fs.chdir(cwd);
        return callableProxy(fs, async (...args) => {
          await fsFixture(fs, cwd)(...args);
          return fs;
        });
      });

      return callableProxy(promise, async (...args) => {
        await promise;
        await fsFixture(fs, cwd)(...args);
        return fs;
      });
    }
  }

  beforeEach(function () {
    _stdout = sinon.stub(process.stdout, 'write');
  });

  afterEach(function () {
    _cwd?.restore();
    _stdout?.restore();
    _cwd = null;
    _stdout = null;
  });

  it('prints help text', async () => {
    let fs = await createFS();
    let cli = createProgram({fs});
    await assert.throws(() => cli('--help'), /\(outputHelp\)/);
  });

  it('links by default', async () => {
    let link = sinon.stub();
    let fs = await createFS();
    let cli = createProgram({fs, link});
    await cli();
    assert(link.called);
  });

  describe('link', () => {
    it('errors for invalid app root', async () => {
      let fs = await createFS('/app');

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('link'), /Not a project root/);
    });

    it('errors for invalid package root', async () => {
      let fs = await createFS('/app')`yarn.lock:`;

      assert(fs.existsSync('/app/yarn.lock'));

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('link /fake'), /Not a package root/);
    });

    it('errors when a link exists', async () => {
      let fs = await createFS('/app')`yarn.lock:`;

      let cli = createProgram({fs});
      await cli(`link`);

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('link'), /link already exists/);
    });

    it('links with the default options', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        node_modules
          parcel
          @parcel/core`;

      let cli = createProgram({fs});
      await cli('link');

      assert(fs.existsSync('.parcel-link'));

      assert.equal(
        fs.realpathSync('node_modules/@parcel/core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        fs.realpathSync('node_modules/parcel'),
        path.resolve(__dirname, '../../parcel'),
      );

      assert.equal(
        fs.realpathSync('node_modules/.bin/parcel'),
        path.resolve(__dirname, '../../parcel/src/bin.js'),
      );
    });

    it('links from a custom package root', async () => {
      let fs = await createFS`
        app
          yarn.lock:
          node_modules
            parcel
            @parcel/core
        package-root
          core
            core/package.json: ${{name: '@parcel/core'}}
            parcel
              package.json: ${{name: 'parcel'}}
              src/bin.js:`;

      fs.chdir('/app');

      let cli = createProgram({fs});
      await cli(`link ../package-root`);

      assert(fs.existsSync('.parcel-link'));

      assert.equal(
        fs.realpathSync('node_modules/@parcel/core'),
        path.resolve(fs.cwd(), '../package-root/core/core'),
      );

      assert.equal(
        fs.realpathSync('node_modules/parcel'),
        path.resolve(fs.cwd(), '../package-root/core/parcel'),
      );

      assert.equal(
        fs.realpathSync('node_modules/.bin/parcel'),
        path.resolve(fs.cwd(), '../package-root/core/parcel/src/bin.js'),
      );
    });

    it('links with a custom namespace', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        node_modules
          .bin/parcel:
          @namespace
            parcel
            parcel-core`;

      let cli = createProgram({fs});
      await cli('link --namespace @namespace');

      assert(fs.existsSync('.parcel-link'));

      assert.equal(
        fs.realpathSync('node_modules/.bin/parcel'),
        path.resolve(__dirname, '../../parcel/src/bin.js'),
      );

      assert.equal(
        fs.realpathSync('node_modules/@namespace/parcel-core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        fs.realpathSync('node_modules/@parcel/core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        fs.realpathSync('node_modules/@namespace/parcel'),
        path.resolve(__dirname, '../../parcel'),
      );

      assert.equal(
        fs.realpathSync('node_modules/parcel'),
        path.resolve(__dirname, '../../parcel'),
      );

      assert.equal(
        fs.realpathSync('node_modules/.bin/parcel'),
        path.resolve(__dirname, '../../parcel/src/bin.js'),
      );
    });

    it('updates config for custom namespace', async () => {
      let fs = await createFS`
        ${path.join(__dirname, '../../../configs/namespace/package.json')}: ${{
        name: '@parcel/config-namespace',
      }}
        app
          yarn.lock:
          .parcelrc: ${{
            extends: '@namespace/parcel-config-namespace',
            transformers: {
              '*': [
                '@namespace/parcel-transformer-js',
                '@namespace/parcel-transformer-local',
              ],
            },
          }}
          package.json: ${{
            ['@namespace/parcel-transformer-js']: {},
            ['@namespace/parcel-transformer-local']: {},
          }}`;

      fs.chdir('/app');

      let cli = createProgram({fs});
      await cli('link --namespace @namespace');

      assert(fs.existsSync('.parcel-link'));

      assert.equal(
        fs.readFileSync('.parcelrc', 'utf8'),
        JSON.stringify({
          extends: '@parcel/config-namespace',
          transformers: {
            '*': [
              '@parcel/transformer-js',
              '@namespace/parcel-transformer-local',
            ],
          },
        }),
      );

      assert.equal(
        fs.readFileSync('package.json', 'utf8'),
        JSON.stringify({
          ['@parcel/transformer-js']: {},
          ['@namespace/parcel-transformer-local']: {},
        }),
      );
    });

    it('links with custom node modules glob', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        tools
          test/node_modules/parcel
          test2/node_modules/@parcel/core`;

      let cli = createProgram({fs});
      await cli('link --node-modules-glob "tools/*/node_modules"');

      assert(fs.existsSync('.parcel-link'));

      assert(fs.existsSync('tools/test/node_modules'));
      assert(!fs.existsSync('tools/test/node_modules/parcel'));

      assert(fs.existsSync('tools/test2/node_modules'));
      assert(!fs.existsSync('tools/test2/node_modules/@parcel/core'));

      assert.equal(
        fs.realpathSync('node_modules/parcel'),
        path.resolve(__dirname, '../../parcel'),
      );

      assert.equal(
        fs.realpathSync('node_modules/.bin/parcel'),
        path.resolve(__dirname, '../../parcel/src/bin.js'),
      );

      assert.equal(
        fs.realpathSync('node_modules/@parcel/core'),
        path.resolve(__dirname, '../../core'),
      );
    });

    it('does not do anything with dry run', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        node_modules
          parcel
          @parcel/core`;

      let cli = createProgram({fs});
      await cli('link --dry-run');

      assert(!fs.existsSync('.parcel-link'));

      assert.equal(
        fs.realpathSync('node_modules/@parcel/core'),
        '/app/node_modules/@parcel/core',
      );

      assert.equal(
        fs.realpathSync('node_modules/parcel'),
        '/app/node_modules/parcel',
      );

      assert(!fs.existsSync('node_modules/.bin/parcel'));
    });
  });

  describe('unlink', () => {
    it('errors without a link config', async () => {
      let fs = await createFS('/app')`yarn.lock:`;

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('unlink'), /link could not be found/);
    });

    it('errors for invalid app root', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        .parcel-link: ${{
          appRoot: '/app2',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@parcel',
        }}`;

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('unlink'), /Not a project root/);
    });

    it('errors for invalid package root', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..') + '2',
          nodeModulesGlobs: ['node_modules'],
          namespace: '@parcel',
        }}`;

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(() => cli('unlink'), /Not a package root/);
    });

    it('unlinks with the default options', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        node_modules
          .bin/parcel -> ${path.resolve(__dirname, '../../parcel/src/bin.js')}
          parcel -> ${path.resolve(__dirname, '../../parcel')}
          @parcel/core -> ${path.resolve(__dirname, '../../core')}
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@parcel',
        }}`;

      assert(fs.existsSync('.parcel-link'));
      assert(fs.existsSync('node_modules/@parcel/core'));
      assert(fs.existsSync('node_modules/parcel'));
      assert(fs.existsSync('node_modules/.bin/parcel'));

      let cli = createProgram({fs});
      await cli('unlink');

      assert(!fs.existsSync('.parcel-link'));
      assert(!fs.existsSync('node_modules/@parcel/core'));
      assert(!fs.existsSync('node_modules/parcel'));
      assert(!fs.existsSync('node_modules/.bin/parcel'));
    });

    it('unlinks from a custom package root', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: '/package-root',
          nodeModulesGlobs: ['node_modules'],
          namespace: '@parcel',
        }}
        node_modules/parcel -> package-root/core/parcel
        node_modules/@parcel/core -> package-root/core/core
        node_modules/.bin/parcel -> package-root/core/parcel/src/bin.js`;

      await fsFixture(fs, '/')`
        package-root/core/core/package.json: ${{name: '@parcel/core'}}
        package-root/core/parcel/package.json: ${{name: 'parcel'}}
        package-root/core/parcel/src/bin.js:`;

      let cli = createProgram({fs});
      await cli('unlink');

      assert(!fs.existsSync('.parcel-link'));
      assert(!fs.existsSync('node_modules/@parcel/core'));
      assert(!fs.existsSync('node_modules/parcel'));
      assert(!fs.existsSync('node_modules/.bin/parcel'));
    });

    it('unlinks with a custom namespace', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@namespace',
        }}
        node_modules
          .bin/parcel -> ${path.resolve(__dirname, '../../parcel/src/bin.js')}
          parcel -> ${path.resolve(__dirname, '../../parcel')}
          @namespace/parcel -> ${path.resolve(__dirname, '../../parcel')}
          parcel/core -> ${path.resolve(__dirname, '../../core')}
          @namespace/parcel-core -> ${path.resolve(__dirname, '../../core')}`;

      let cli = createProgram({fs});
      await cli('unlink');

      assert(!fs.existsSync('.parcel-link'));
      assert(!fs.existsSync('node_modules/@parcel/core'));
      assert(!fs.existsSync('node_modules/parcel'));
      assert(!fs.existsSync('node_modules/.bin/parcel'));
      assert(!fs.existsSync('node_modules/@namespace/parcel-core'));
      assert(!fs.existsSync('node_modules/@namespace/parcel'));
    });

    it('updates config for custom namespace', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        .parcelrc: ${{
          extends: '@parcel/config-namespace',
          transformers: {
            '*': [
              '@parcel/transformer-js',
              '@namespace/parcel-transformer-local',
            ],
          },
        }}
        package.json: ${{
          ['@parcel/transformer-js']: {},
          ['@namespace/parcel-transformer-local']: {},
        }}
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@namespace',
        }}`;

      await fsFixture(fs, '/')`
        ${path.join(__dirname, '../../../configs/namespace/package.json')}: ${{
        name: '@parcel/config-namespace',
      }}`;

      let cli = createProgram({fs});
      await cli('unlink');

      assert(!fs.existsSync('.parcel-link'));

      assert.equal(
        fs.readFileSync('.parcelrc', 'utf8'),
        JSON.stringify({
          extends: '@namespace/parcel-config-namespace',
          transformers: {
            '*': [
              '@namespace/parcel-transformer-js',
              '@namespace/parcel-transformer-local',
            ],
          },
        }),
      );

      assert.equal(
        fs.readFileSync('package.json', 'utf8'),
        JSON.stringify({
          ['@namespace/parcel-transformer-js']: {},
          ['@namespace/parcel-transformer-local']: {},
        }),
      );
    });

    it('unlinks with custom node modules glob', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules', 'tools/*/node_modules'],
          namespace: '@parcel',
        }}
        node_modules
          parcel -> ${path.resolve(__dirname, '../../parcel')}
          @parcel/core -> ${path.resolve(__dirname, '../../core')}
          .bin/parcel -> ${path.resolve(__dirname, '../../parcel/src/bin.js')}
        tools
          test/node_modules/parcel -> ${path.resolve(__dirname, '../../parcel')}
          test2/node_modules/@parcel/core -> ${path.resolve(
            __dirname,
            '../../core',
          )}`;

      let cli = createProgram({fs});
      await cli('unlink');

      assert(!fs.existsSync('.parcel-link'));
      assert(!fs.existsSync('node_modules/@parcel/core'));
      assert(!fs.existsSync('node_modules/parcel'));
      assert(!fs.existsSync('node_modules/.bin/parcel'));
      assert(!fs.existsSync('tools/test/node_modules/parcel'));
      assert(!fs.existsSync('tools/test2/node_modules/@parcel/core'));
    });

    it('does not do anything with dry run', async () => {
      let fs = await createFS('/app')`
        yarn.lock:
        node_modules
          .bin/parcel -> ${path.resolve(__dirname, '../../parcel/src/bin.js')}
          parcel -> ${path.resolve(__dirname, '../../parcel')}
          @parcel/core -> ${path.resolve(__dirname, '../../core')}
        .parcel-link: ${{
          appRoot: '/app',
          packageRoot: path.resolve(__dirname, '../../..'),
          nodeModulesGlobs: ['node_modules'],
          namespace: '@parcel',
        }}
      `;

      let cli = createProgram({fs});
      await cli('unlink --dry-run');

      assert(fs.existsSync('.parcel-link'));

      assert.equal(
        fs.realpathSync('node_modules/@parcel/core'),
        path.resolve(__dirname, '../../core'),
      );

      assert.equal(
        fs.realpathSync('node_modules/parcel'),
        path.resolve(__dirname, '../../parcel'),
      );

      assert.equal(
        fs.realpathSync('node_modules/.bin/parcel'),
        path.resolve(__dirname, '../../parcel/src/bin.js'),
      );
    });
  });
});
