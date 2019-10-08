import assert from 'assert';
import path from 'path';
import {bundle, assertBundles, outputFS, inputFS} from '@parcel/test-utils';

describe('typescript types', function() {
  it('should generate a typescript declaration file', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/ts-types/main/index.ts')
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.ts']
      },
      {
        type: 'ts',
        assets: ['index.ts']
      }
    ]);

    let dist = (await outputFS.readFile(
      path.join(__dirname, '/integration/ts-types/main/dist/types.d.ts'),
      'utf8'
    )).replace(/\r\n/g, '\n');
    let expected = await inputFS.readFile(
      path.join(__dirname, '/integration/ts-types/main/expected.d.ts'),
      'utf8'
    );
    assert.equal(dist, expected);
  });

  it('should generate ts declarations with imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/ts-types/importing/index.ts')
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.ts', 'file.ts', 'namespace.ts']
      },
      {
        type: 'ts',
        assets: ['index.ts'],
        includedFiles: {
          'index.ts': ['other.ts', 'file.ts', 'namespace.ts']
        }
      }
    ]);

    let dist = (await outputFS.readFile(
      path.join(__dirname, '/integration/ts-types/importing/dist/types.d.ts'),
      'utf8'
    )).replace(/\r\n/g, '\n');
    let expected = await inputFS.readFile(
      path.join(__dirname, '/integration/ts-types/importing/expected.d.ts'),
      'utf8'
    );
    assert.equal(dist, expected);
  });

  it('should generate ts declarations with exports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/ts-types/exporting/index.ts')
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.ts', 'message.ts', 'other.ts', 'test.ts']
      },
      {
        type: 'ts',
        assets: ['index.ts'],
        includedFiles: {
          'index.ts': ['message.ts', 'other.ts', 'test.ts']
        }
      }
    ]);

    let dist = (await outputFS.readFile(
      path.join(__dirname, '/integration/ts-types/exporting/dist/types.d.ts'),
      'utf8'
    )).replace(/\r\n/g, '\n');
    let expected = await inputFS.readFile(
      path.join(__dirname, '/integration/ts-types/exporting/expected.d.ts'),
      'utf8'
    );
    assert.equal(dist, expected);
  });

  it('should generate ts declarations with imports', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/ts-types/externals/index.tsx')
    );

    assertBundles(b, [
      {
        type: 'js',
        assets: ['index.tsx', 'other.tsx']
      },
      {
        type: 'ts',
        assets: ['index.tsx'],
        includedFiles: {
          'index.ts': ['other.tsx']
        }
      }
    ]);

    let dist = (await outputFS.readFile(
      path.join(__dirname, '/integration/ts-types/externals/dist/types.d.ts'),
      'utf8'
    )).replace(/\r\n/g, '\n');
    let expected = await inputFS.readFile(
      path.join(__dirname, '/integration/ts-types/externals/expected.d.ts'),
      'utf8'
    );
    assert.equal(dist, expected);
  });
});
