// @flow strict-local

import assert from 'assert';
import path from 'path';
import tempy from 'tempy';
import {inputFS as fs} from '@parcel/test-utils';
import {EntryResolver} from '../src/requests/EntryRequest';
import {DEFAULT_OPTIONS as _DEFAULT_OPTIONS} from './test-utils';

const DEFAULT_OPTIONS = {
  ..._DEFAULT_OPTIONS,
  defaultTargetOptions: {
    ..._DEFAULT_OPTIONS.defaultTargetOptions,
    sourceMaps: true,
  },
};

const MULTI_ENTRY_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/multi-entry-package',
);

describe('EntryResolver', () => {
  let cacheDir;
  beforeEach(() => {
    cacheDir = tempy.directory();
  });

  afterEach(() => {
    return fs.rimraf(cacheDir);
  });

  it('resolves specified targets entry with custom sources', async () => {
    let entryResolver = new EntryResolver({
      ...DEFAULT_OPTIONS,
      targets: {
        alternate: {
          source: 'src/indexAlternate.js',
        },
        browser: {
          engines: {
            browsers: ['last 1 Chrome version'],
          },
        },
      },
    });

    assert.deepStrictEqual(
      await entryResolver.resolveEntry(MULTI_ENTRY_FIXTURE_PATH),
      {
        entries: [
          {
            filePath: path.join(MULTI_ENTRY_FIXTURE_PATH, 'src/index.js'),
            packagePath: MULTI_ENTRY_FIXTURE_PATH,
          },
          {
            filePath: path.join(
              MULTI_ENTRY_FIXTURE_PATH,
              'src/indexAlternate.js',
            ),
            packagePath: MULTI_ENTRY_FIXTURE_PATH,
            target: 'alternate',
          },
        ],
        files: [
          {
            filePath: path.join(MULTI_ENTRY_FIXTURE_PATH, 'package.json'),
          },
        ],
      },
    );
  });
});
