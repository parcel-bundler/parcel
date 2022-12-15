// @flow strict-local

import type {FileSystem} from '@parcel/fs';
import type {ProgramOptions} from '@parcel/link';

import {MemoryFS} from '@parcel/fs';
import {createProgram} from '@parcel/link';
import {workerFarm} from '@parcel/test-utils';

// import {execSync} from 'child_process';
import assert from 'assert';
import sinon from 'sinon';

function createTestProgram(opts: {|...ProgramOptions, fs: FileSystem|}) {
  let program = createProgram(opts).exitOverride();

  function cli(command: string = ''): Promise<void> {
    return program.parseAsync(command.split(/\s+/), {from: 'user'});
  }

  return cli;
}

describe('@parcel/link', () => {
  let cwd;
  let stdout;
  let fs;

  beforeEach(async function () {
    // $FlowFixMe[incompatible-call]
    cwd = sinon.stub(process, 'cwd').callsFake(() => fs.cwd());
    stdout = sinon.stub(process.stdout, 'write');
    fs = new MemoryFS(workerFarm);
  });

  afterEach(async function () {
    cwd.restore();
    stdout.restore();
  });

  it('prints help text', async () => {
    let cli = createTestProgram({fs});
    // $FlowFixMe[prop-missing]
    await assert.rejects(async () => cli('--help'), /\(outputHelp\)/);
  });

  it('links by default', async () => {
    let link = sinon.stub();
    let cli = createTestProgram({fs, link});

    assert(link.called);

    await cli();
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
