import assert from 'assert';
import path from 'path';
import {bundle, assertBundles, outputFS} from '@parcel/test-utils';

describe('webextension', function () {
  it('should resolve a full webextension bundle', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/webextension/manifest.json'),
    );
    assertBundles(b, [
      {
        name: 'tmp.aff',
        assets: ['tmp.aff'],
      },
      {
        name: 'tmp.dic',
        assets: ['tmp.dic'],
      },
      {
        name: 'messages.json',
        assets: ['messages.json'],
      },
      {
        name: 'manifest.json',
        assets: ['manifest.json'],
      },
      {
        name: 'background.js',
        assets: ['background.ts'],
      },
      {assets: ['a.txt']},
      {assets: ['b.txt']},
      {assets: ['foo.png']},
      {assets: ['foo-dark.png']},
      {assets: ['popup.html']},
      {assets: ['devtools.html']},
      {assets: ['content.js']},
      {assets: ['content.css']},
    ]);
  });

  it('should resolve the web_accessible_resources globs', async function () {
    let b = await bundle(
      path.join(
        __dirname,
        '/integration/webextension-resolve-web-accessible-resources/manifest.json',
      ),
    );
    assertBundles(b, [
      {
        name: 'manifest.json',
        assets: ['manifest.json'],
      },
      {
        name: 'index.js',
        assets: ['index.ts', 'esmodule-helpers.js'],
      },
      {
        name: 'other.js',
        assets: ['other.ts', 'esmodule-helpers.js'],
      },
      {
        name: 'index-jsx.js',
        assets: [
          'esmodule-helpers.js',
          'index-jsx.jsx',
          'index.js',
          'index.js',
          'react.development.js',
        ],
      },
      {assets: ['single.js', 'esmodule-helpers.js']},
    ]);
    const manifest = JSON.parse(
      await outputFS.readFile(
        b.getBundles().find(b => b.name == 'manifest.json').filePath,
        'utf8',
      ),
    );
    const war = manifest.web_accessible_resources;
    assert.deepEqual(war, [
      '/injected/index.js',
      '/injected/nested/other.js',
      '/injected/index-jsx.js',
      '/injected/single.js',
    ]);
  });
  // TODO: Test error-checking
});
