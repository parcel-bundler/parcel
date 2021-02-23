// @flow strict-local

import assert from 'assert';
import path from 'path';
import tempy from 'tempy';
import {inputFS as fs, inputFS} from '@parcel/test-utils';
import {EntryResolver} from '../src/requests/EntryRequest';
import {DEFAULT_OPTIONS as _DEFAULT_OPTIONS} from './test-utils';

const DEFAULT_OPTIONS = {
  ..._DEFAULT_OPTIONS,
  defaultTargetOptions: {
    ..._DEFAULT_OPTIONS.defaultTargetOptions,
    sourceMaps: true,
  },
};

const INVALID_SOURCE_MISSING_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-source-missing',
);

const INVALID_SOURCE_NOT_FILE_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-source-not-file',
);

const INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-target-source-missing',
);

const INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/invalid-target-source-not-file',
);

describe('EntryResolver', () => {
  let entryResolver = new EntryResolver({...DEFAULT_OPTIONS});
  it('rejects missing source in package.json', async () => {
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      async () =>
        await entryResolver.resolveEntry(INVALID_SOURCE_MISSING_FIXTURE_PATH),
      {
        message: `missing.js in ${path.relative(
          inputFS.cwd(),
          INVALID_SOURCE_MISSING_FIXTURE_PATH,
        )}/package.json#source does not exist`,
      },
    );
  });
  it('rejects non-file source in package.json', async () => {
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      async () =>
        await entryResolver.resolveEntry(INVALID_SOURCE_NOT_FILE_FIXTURE_PATH),
      {
        message: `src in ${path.relative(
          inputFS.cwd(),
          INVALID_SOURCE_NOT_FILE_FIXTURE_PATH,
        )}/package.json#source is not a file`,
      },
    );
  });
  it('rejects missing target source in package.json', async () => {
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      async () =>
        await entryResolver.resolveEntry(
          INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH,
        ),
      {
        message: `missing.js in ${path.relative(
          inputFS.cwd(),
          INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH,
        )}/package.json#targets["a"].source does not exist`,
      },
    );
  });
  it('rejects non-file target source in package.json', async () => {
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      async () =>
        await entryResolver.resolveEntry(
          INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH,
        ),
      {
        message: `src in ${path.relative(
          inputFS.cwd(),
          INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH,
        )}/package.json#targets["a"].source is not a file`,
      },
    );
  });
});
