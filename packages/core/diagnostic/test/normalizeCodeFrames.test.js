// @flow
import assert from 'assert';

import {normalizeCodeFrames} from '../src/diagnostic';

describe('normalizeCodeFrames', () => {
  it('leaves diagnostics without codeFrames untouched', async () => {
    let diagnostics = [{message: 'oops'}];
    let result = await normalizeCodeFrames(diagnostics, async () => {
      throw new Error('should not be called');
    });
    assert.deepStrictEqual(result, diagnostics);
  });

  it('leaves an existing codeFrame.code untouched', async () => {
    let diagnostics = [
      {
        message: 'oops',
        codeFrames: [
          {
            code: 'const x = 1;',
            filePath: 'index.js',
            codeHighlights: [],
          },
        ],
      },
    ];
    let result = await normalizeCodeFrames(diagnostics, async () => {
      throw new Error('should not be called');
    });
    assert.strictEqual(result[0].codeFrames?.[0].code, 'const x = 1;');
  });

  it('fills in codeFrame.code by reading the file when missing', async () => {
    let diagnostics = [
      {
        message: 'oops',
        codeFrames: [
          {
            filePath: 'index.js',
            codeHighlights: [],
          },
        ],
      },
    ];

    let readFilePaths = [];
    let result = await normalizeCodeFrames(diagnostics, async filePath => {
      readFilePaths.push(filePath);
      return 'const x = 1;';
    });

    assert.deepStrictEqual(readFilePaths, ['index.js']);
    assert.strictEqual(result[0].codeFrames?.[0].code, 'const x = 1;');
  });

  it('joins a relative filePath with projectRoot before reading', async () => {
    let diagnostics = [
      {
        message: 'oops',
        codeFrames: [
          {
            filePath: 'src/index.js',
            codeHighlights: [],
          },
        ],
      },
    ];

    let readFilePaths = [];
    let result = await normalizeCodeFrames(
      diagnostics,
      async filePath => {
        readFilePaths.push(filePath);
        return 'const x = 1;';
      },
      '/project',
    );

    assert.strictEqual(readFilePaths[0], '/project/src/index.js');
    assert.strictEqual(result[0].codeFrames?.[0].code, 'const x = 1;');
  });

  it('leaves codeFrame.code unset if the file cannot be read', async () => {
    let diagnostics = [
      {
        message: 'oops',
        codeFrames: [
          {
            filePath: 'deleted.js',
            codeHighlights: [],
          },
        ],
      },
    ];

    let result = await normalizeCodeFrames(diagnostics, async () => {
      throw new Error('ENOENT: no such file');
    });

    assert.strictEqual(result[0].codeFrames?.[0].code, undefined);
  });

  it('does not mutate the input diagnostics', async () => {
    let codeFrame = {filePath: 'index.js', codeHighlights: []};
    let diagnostics = [{message: 'oops', codeFrames: [codeFrame]}];

    await normalizeCodeFrames(diagnostics, async () => 'const x = 1;');

    assert.strictEqual(codeFrame.code, undefined);
  });
});
