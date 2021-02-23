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

function packagePath(fixturePath) {
  return path.join(path.relative(inputFS.cwd(), fixturePath), '/package.json');
}

describe.only('EntryResolver', () => {
  let entryResolver = new EntryResolver({...DEFAULT_OPTIONS});
  it('rejects missing source in package.json', async () => {
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      async () =>
        await entryResolver.resolveEntry(INVALID_SOURCE_MISSING_FIXTURE_PATH),
      {
        message: `missing.js in ${packagePath(
          INVALID_SOURCE_MISSING_FIXTURE_PATH,
        )}#source does not exist`,
      },
    );
  });
  it('rejects non-file source in package.json', async () => {
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      async () =>
        await entryResolver.resolveEntry(INVALID_SOURCE_NOT_FILE_FIXTURE_PATH),
      {
        message: `src in ${packagePath(
          INVALID_SOURCE_NOT_FILE_FIXTURE_PATH,
        )}#source is not a file`,
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
        message: `missing.js in ${packagePath(
          INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH,
        )}#targets["a"].source does not exist`,
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
        message: `src in ${packagePath(
          INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH,
        )}#targets["a"].source is not a file`,
      },
    );
  });
});
