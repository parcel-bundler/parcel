// @flow

import assert from 'assert';
import {execSync} from 'child_process';
import path from 'path';

import {INTERNAL_ORIGINAL_CONSOLE} from '@parcel/logger';
import {bundle} from '@parcel/test-utils';
import sinon from 'sinon';

describe('reporters', () => {
  let successfulEntry = path.join(
    __dirname,
    'integration',
    'reporters-success',
    'index.js',
  );

  let failingEntry = path.join(
    __dirname,
    'integration',
    'reporters-failure',
    'index.js',
  );

  describe('running on the cli', () => {
    it('exit successfully when no errors are emitted', () => {
      assert.doesNotThrow(() =>
        execSync(`parcel build --no-cache ${successfulEntry}`, {
          stdio: 'ignore',
        }),
      );
    });

    it('exit with an error code when an error is emitted', () => {
      assert.throws(() =>
        execSync(`parcel build --no-cache ${failingEntry}`, {stdio: 'ignore'}),
      );
    });
  });

  describe('running on the programmatic api', () => {
    let consoleError;
    let processExitCode;

    beforeEach(() => {
      processExitCode = process.exitCode;
      consoleError = sinon.stub(INTERNAL_ORIGINAL_CONSOLE, 'error');
    });

    afterEach(() => {
      process.exitCode = processExitCode;
      sinon.restore();
    });

    it('exit successfully when no errors are emitted', async () => {
      await bundle(successfulEntry);

      assert(!process.exitCode);
    });

    it('exit with an error code when an error is emitted', async () => {
      await bundle(failingEntry);

      assert.equal(process.exitCode, 1);
      assert(
        consoleError.calledWithMatch({
          message: 'Failed to report buildSuccess',
        }),
      );
    });
  });
});
