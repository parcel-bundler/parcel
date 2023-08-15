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
    it.skip('errors when a link exists', () => {});
    it.skip('does not do anything with --dryRun', () => {});
    it.skip('links with the default options', () => {});
    it.skip('links from a custom --packageRoot', () => {});
    it.skip('links with a custom --namespace', () => {});
    it.skip('links with custom --nodeModulesGlob', () => {});
  });

  describe('unlink', () => {
    it.skip('errors without a link config', () => {});
    it.skip('does not do anything with --dryRun', () => {});
    it.skip('unlinks', () => {});
  });
});
