// @flow

import assert from 'assert';
import path from 'path';

import {INTERNAL_ORIGINAL_CONSOLE} from '@parcel/logger';
import {bundle, fsFixture, overlayFS} from '@parcel/test-utils';
import sinon from 'sinon';

describe.only('reporters', () => {
  let consoleError;
  let processExitCode;
  let dir = path.join(__dirname, 'reporters');

  beforeEach(async () => {
    processExitCode = process.exitCode;
    consoleError = sinon.stub(INTERNAL_ORIGINAL_CONSOLE, 'error');
    await overlayFS.mkdirp(dir);
  });

  afterEach(async () => {
    process.exitCode = processExitCode;
    sinon.restore();
  });

  after(async () => {
    await overlayFS.rimraf(dir);
  });

  async function createReporterFixture(name: string, reporter: string) {
    let cwd = path.join(dir, name);

    await overlayFS.mkdirp(cwd);

    await fsFixture(overlayFS, cwd)`
      index.js:
        export function main() {}

      test-reporter/index.js:
        ${reporter}

      test-reporter/package.json:
        {
          "name": "test-reporter",
          "main": "index.js",
          "version": "1.0.0"
        }

      .parcelrc:
        {
          "extends": "@parcel/config-default",
          "reporters": ["./test-reporter"]
        }

      yarn.lock: {}
    `;

    return cwd;
  }

  it('exit successfully when no errors are emitted', async () => {
    let cwd = await createReporterFixture(
      'success',
      `
      test-reporter/index.js:
        const { Reporter } = require('@parcel/plugin');

        module.exports = new Reporter({
          async report({ event }) {}
        });
    `,
    );

    await bundle(path.join(cwd, 'index.js'), {
      inputFS: overlayFS,
    });

    assert(!process.exitCode);
  });

  it('exit with an error code when an error is emitted', async () => {
    let cwd = await createReporterFixture(
      'error',
      `
      test-reporter/index.js:
        const { Reporter } = require('@parcel/plugin');

        module.exports = new Reporter({
          async report({ event }) {
            if (event.type === 'buildSuccess') {
              throw new Error('Failed to report buildSuccess');
            }
          }
        });
    `,
    );

    await bundle(path.join(cwd, 'index.js'), {
      inputFS: overlayFS,
    });

    assert.equal(process.exitCode, 1);
    assert(
      consoleError.calledWithMatch({message: 'Failed to report buildSuccess'}),
    );
  });
});
