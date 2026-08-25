// @flow strict-local
import assert from 'assert';
import path from 'path';
import {md} from '@parcel/diagnostic';
import {inputFS as fs, outputFS} from '@parcel/test-utils';
import {EntryResolver} from '../src/requests/EntryRequest';
import {toProjectPath} from '../src/projectPath';
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

const GLOB_LIKE_FIXTURE_PATH = path.join(
  __dirname,
  'fixtures/glob-like/[entry].js',
);

describe('EntryResolver', function () {
  let entryResolver = new EntryResolver({...DEFAULT_OPTIONS});

  it('supports a UTF-8 BOM in package.json', async function () {
    let fixturePath = path.join(__dirname, 'fixtures/package-bom');
    await outputFS.mkdirp(fixturePath);
    await outputFS.writeFile(
      path.join(fixturePath, 'package.json'),
      '\uFEFF' + JSON.stringify({source: 'index.js'}),
    );
    await outputFS.writeFile(path.join(fixturePath, 'index.js'), '');

    let result = await new EntryResolver({
      ...DEFAULT_OPTIONS,
      inputFS: outputFS,
      outputFS,
      projectRoot: fixturePath,
    }).resolveEntry(fixturePath);

    assert.equal(result.entries.length, 1);
    assert.equal(
      result.entries[0].filePath,
      toProjectPath(fixturePath, path.join(fixturePath, 'index.js')),
    );
  });

  it('rejects missing source in package.json', async function () {
    this.timeout(10000);
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () => entryResolver.resolveEntry(INVALID_SOURCE_MISSING_FIXTURE_PATH),
      {
        diagnostics: [
          {
            origin: '@parcel/core',
            message: md`${path.join(
              path.relative(fs.cwd(), INVALID_SOURCE_MISSING_FIXTURE_PATH),
              'missing.js',
            )} does not exist.`,
            codeFrames: [
              {
                filePath: path.join(
                  INVALID_SOURCE_MISSING_FIXTURE_PATH,
                  'package.json',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 4,
                      column: 13,
                    },
                    end: {
                      line: 4,
                      column: 24,
                    },
                  },
                ],
              },
            ],
            hints: [],
          },
        ],
      },
    );
  });
  it('rejects non-file source in package.json', async function () {
    this.timeout(10000);
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () => entryResolver.resolveEntry(INVALID_SOURCE_NOT_FILE_FIXTURE_PATH),
      {
        diagnostics: [
          {
            origin: '@parcel/core',
            message: md`${path.join(
              path.relative(fs.cwd(), INVALID_SOURCE_NOT_FILE_FIXTURE_PATH),
              'src',
            )} is not a file.`,
            codeFrames: [
              {
                filePath: path.join(
                  INVALID_SOURCE_NOT_FILE_FIXTURE_PATH,
                  'package.json',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 4,
                      column: 13,
                    },
                    end: {
                      line: 4,
                      column: 17,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
  });
  it('rejects missing target source in package.json', async function () {
    this.timeout(10000);
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () =>
        entryResolver.resolveEntry(INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH),
      {
        diagnostics: [
          {
            origin: '@parcel/core',
            message: md`${path.join(
              path.relative(
                fs.cwd(),
                INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH,
              ),
              'missing.js',
            )} does not exist.`,
            codeFrames: [
              {
                filePath: path.join(
                  INVALID_TARGET_SOURCE_MISSING_FIXTURE_PATH,
                  'package.json',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 6,
                      column: 17,
                    },
                    end: {
                      line: 6,
                      column: 28,
                    },
                  },
                ],
              },
            ],
            hints: [],
          },
        ],
      },
    );
  });
  it('rejects non-file target source in package.json', async function () {
    this.timeout(10000);
    // $FlowFixMe assert.rejects is Node 10+
    await assert.rejects(
      () =>
        entryResolver.resolveEntry(INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH),
      {
        diagnostics: [
          {
            origin: '@parcel/core',
            message: md`${path.join(
              path.relative(
                fs.cwd(),
                INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH,
              ),
              'src',
            )} is not a file.`,
            codeFrames: [
              {
                filePath: path.join(
                  INVALID_TARGET_SOURCE_NOT_FILE_FIXTURE_PATH,
                  'package.json',
                ),
                codeHighlights: [
                  {
                    message: undefined,
                    start: {
                      line: 6,
                      column: 17,
                    },
                    end: {
                      line: 6,
                      column: 21,
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
    );
  });
  it('does not time out on glob-like entry', async function () {
    this.timeout(10000);
    await entryResolver.resolveEntry(GLOB_LIKE_FIXTURE_PATH);
  });
});
