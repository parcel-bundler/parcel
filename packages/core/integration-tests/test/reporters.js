// @flow

import assert from 'assert';
import {execSync} from 'child_process';
import path from 'path';

import {bundler, describe, it} from '@parcel/test-utils';

describe.v2('reporters', () => {
  let successfulEntry = path.join(
    __dirname,
    'integration',
    'reporters-success',
    'index.js',
  );

  let loadReporterFailureEntry = path.join(
    __dirname,
    'integration',
    'reporters-load-failure',
    'index.js',
  );

  let failingReporterEntry = path.join(
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

    it('exit with an error code when a reporter fails to load', () => {
      assert.throws(() =>
        execSync(`parcel build --no-cache ${loadReporterFailureEntry}`, {
          stdio: 'ignore',
        }),
      );
    });

    it('exit with an error code when a reporter emits an error', () => {
      assert.throws(() =>
        execSync(`parcel build --no-cache ${failingReporterEntry}`, {
          stdio: 'ignore',
        }),
      );
    });
  });

  describe('running on the programmatic api', () => {
    it('resolves when no errors are emitted', async () => {
      let buildEvent = await bundler(successfulEntry).run();

      assert.equal(buildEvent.type, 'buildSuccess');
    });

    it('rejects when a reporter fails to load', async () => {
      try {
        let buildEvent = await bundler(loadReporterFailureEntry).run();

        throw new Error(buildEvent);
      } catch (err) {
        assert.equal(err.name, 'Error');
        assert.deepEqual(
          err.diagnostics.map(d => d.message),
          ['Cannot find Parcel plugin "./test-reporter"'],
        );
      }
    });

    it('rejects when a reporter emits an error', async () => {
      try {
        let buildEvent = await bundler(failingReporterEntry).run();

        throw new Error(buildEvent);
      } catch (err) {
        assert.equal(err.name, 'BuildError');
        assert.deepEqual(
          err.diagnostics.map(d => d.message),
          ['Failed to report buildSuccess'],
        );
      }
    });
  });
});
