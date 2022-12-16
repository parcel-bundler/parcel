// @flow strict-local

import type {FileSystem} from '@parcel/fs';
import type {ProgramOptions} from '@parcel/link';

import {MemoryFS, NodeFS, OverlayFS, ncp} from '@parcel/fs';
import {createProgram} from '@parcel/link';
import {workerFarm} from '@parcel/test-utils';

import assert from 'assert';
import path from 'path';
import sinon from 'sinon';

function createTestProgram(opts: {|...ProgramOptions, fs: FileSystem|}) {
  let program = createProgram(opts).exitOverride();

  function cli(command: string = ''): Promise<void> {
    return program.parseAsync(command.split(/\s+/), {from: 'user'});
  }

  return cli;
}

describe('@parcel/link', () => {
  let _cwd;
  let _stdout;

  async function createFS(dir?: string): Promise<FileSystem> {
    assert(_cwd == null, 'FS already exists!');
    let inputFS = new NodeFS();
    let outputFS = new MemoryFS(workerFarm);
    let fs = new OverlayFS(outputFS, inputFS);
    if (dir != null) {
      fs.chdir(dir);
      await ncp(inputFS, dir, outputFS, dir);
    }
    // $FlowFixMe[incompatible-call]
    _cwd = sinon.stub(process, 'cwd').callsFake(() => fs.cwd());
    return fs;
  }

  beforeEach(async function () {
    _stdout = sinon.stub(process.stdout, 'write');
  });

  afterEach(async function () {
    _cwd?.restore();
    _stdout?.restore();
    _cwd = null;
    _stdout = null;
  });

  it('prints help text', async () => {
    let fs = await createFS();
    let cli = createTestProgram({fs});
    // $FlowFixMe[prop-missing]
    await assert.rejects(async () => cli('--help'), /\(outputHelp\)/);
  });

  it('links by default', async () => {
    let link = sinon.stub();
    let fs = await createFS();
    let cli = createTestProgram({fs, link});
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
