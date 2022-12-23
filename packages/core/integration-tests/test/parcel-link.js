// @flow strict-local

import type {FileSystem} from '@parcel/fs';
import type {ProgramOptions} from '@parcel/link';

import {createProgram as _createProgram} from '@parcel/link';
import {workerFarm, inputFS} from '@parcel/test-utils';
import {OverlayFS} from '@parcel/fs';

import assert from 'assert';
import sinon from 'sinon';

function createProgram(opts: {|...ProgramOptions, fs: FileSystem|}) {
  let program = _createProgram(opts).exitOverride();

  function cli(command: string = ''): Promise<void> {
    return program.parseAsync(command.split(/\s+/), {from: 'user'});
  }

  return cli;
}

describe('@parcel/link', () => {
  let _cwd;
  let _stdout;

  function createFS(dir?: string) {
    assert(_cwd == null, 'FS already exists!');

    let fs = new OverlayFS(workerFarm, inputFS);
    if (dir != null) fs.chdir(dir);

    // $FlowFixMe[incompatible-call]
    _cwd = sinon.stub(process, 'cwd').callsFake(() => fs.cwd());

    return fs;
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
    let fs = createFS();
    let cli = createProgram({fs});
    // $FlowFixMe[prop-missing]
    await assert.rejects(() => cli('--help'), /\(outputHelp\)/);
  });

  it('links by default', async () => {
    let link = sinon.stub();
    let fs = createFS();
    let cli = createProgram({fs, link});
    await cli();
    assert(link.called);
  });

  describe('link', () => {
    it('errors for invalid app root', async () => {
      let fs = createFS('/app');

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(async () => cli('link'), /Not a project root/);
    });

    it('errors for invalid package root', async () => {
      let fs = createFS('/app');
      await fs.writeFile('yarn.lock', '');

      let cli = createProgram({fs});

      // $FlowFixMe[prop-missing]
      await assert.rejects(async () => cli('link /fake'), /Not a package root/);
    });

    it('errors when a link exists', async () => {
      let fs = createFS('/app');
      await fs.writeFile('yarn.lock', '');

      let cli = createProgram({fs});
      await cli(`link`);

      // $FlowFixMe[prop-missing]
      await assert.rejects(async () => cli('link'), /link already exists/);
    });

    it('links with the default options', async () => {
      let fs = createFS('/app');
      await fs.writeFile('yarn.lock', '');
      await fs.mkdirp('node_modules/parcel');
      await fs.mkdirp('node_modules/@parcel/core');

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
      let fs = createFS('/app');
      await fs.writeFile('yarn.lock', '');
      await fs.mkdirp('node_modules/parcel');
      await fs.mkdirp('node_modules/@parcel/core');

      await fs.writeFile(
        '../package-root/core/core/package.json',
        '{"name": "@parcel/core"}',
      );

      await fs.writeFile(
        '../package-root/core/parcel/package.json',
        '{"name": "parcel"}',
      );

      await fs.writeFile('../package-root/core/parcel/src/bin.js', '');

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
      let fs = createFS('/app');
      await fs.writeFile('yarn.lock', '');
      await fs.mkdirp('node_modules/@namespace/parcel');
      await fs.mkdirp('node_modules/@namespace/parcel-core');

      let cli = createProgram({fs});
      await cli('link --namespace @namespace');

      assert(fs.existsSync('.parcel-link'));

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
      let fs = createFS('/app');
      await fs.writeFile('yarn.lock', '');

      await fs.writeFile(
        '.parcelrc',
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

      await fs.writeFile(
        'package.json',
        JSON.stringify({
          ['@namespace/parcel-transformer-js']: {},
          ['@namespace/parcel-transformer-local']: {},
        }),
      );

      await fs.writeFile(
        path.join(__dirname, '../../../configs/namespace/package.json'),
        '{"name": "@parcel/config-namespace"}',
      );

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

    it.skip('links with custom node modules glob', () => {});
    it.skip('does not do anything with dry run', () => {});
  });

  describe('unlink', () => {
    it.skip('errors without a link config', () => {});
    it.skip('does not do anything with --dryRun', () => {});
    it.skip('unlinks', () => {});
  });
});
