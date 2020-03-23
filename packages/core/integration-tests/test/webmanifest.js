import assert from 'assert';
import path from 'path';
import {bundle, assertBundles, inputFS, outputFS} from '@parcel/test-utils';
import {escapeMarkdown} from '@parcel/utils';

describe('webmanifest', function() {
  it('should support .webmanifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webmanifest/index.html'),
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'webmanifest',
        assets: ['manifest.webmanifest'],
      },
      {
        type: 'png',
        assets: ['icon.png'],
      },
      {
        type: 'png',
        assets: ['screenshot.png'],
      },
    ]);

    const manifest = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'webmanifest').filePath,
      'utf8',
    );
    assert(/screenshot\.[0-9a-f]+\.png/.test(manifest));
    assert(/icon\.[0-9a-f]+\.png/.test(manifest));
  });

  it('should support using a json file as manifest', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/webmanifest-json/index.html'),
    );

    await assertBundles(b, [
      {
        name: 'index.html',
        assets: ['index.html'],
      },
      {
        type: 'webmanifest',
        assets: ['manifest.json'],
      },
      {
        type: 'png',
        assets: ['icon.png'],
      },
      {
        type: 'png',
        assets: ['screenshot.png'],
      },
    ]);

    const manifest = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'webmanifest').filePath,
      'utf8',
    );
    assert(/screenshot\.[0-9a-f]+\.png/.test(manifest));
    assert(/icon\.[0-9a-f]+\.png/.test(manifest));
  });

  it('should throw on malformed icons and screenshots', async function() {
    let manifestPath = path.join(
      __dirname,
      '/integration/webmanifest-schema/manifest.webmanifest',
    );
    let manifest = await inputFS.readFileSync(manifestPath, 'utf8');

    await assert.rejects(
      () =>
        bundle(
          path.join(__dirname, '/integration/webmanifest-schema/index.html'),
        ),
      {
        name: 'BuildError',
        message: path.normalize('Invalid webmanifest'),
        diagnostics: [
          {
            codeFrame: {
              code: manifest,
              codeHighlights: [
                {
                  end: {
                    column: 5,
                    line: 12,
                  },
                  message: 'Did you mean "src"?',
                  start: {
                    column: 5,
                    line: 9,
                  },
                },
                {
                  end: {
                    column: 6,
                    line: 13,
                  },
                  message: 'Did you mean "src"?',
                  start: {
                    column: 5,
                    line: 13,
                  },
                },
                {
                  end: {
                    column: 19,
                    line: 15,
                  },
                  message: 'Expected type array',
                  start: {
                    column: 18,
                    line: 15,
                  },
                },
              ],
            },
            filePath: manifestPath,
            language: 'json',
            message: 'Invalid webmanifest',
            origin: '@parcel/transformer-webmanifest',
          },
        ],
      },
    );
  });

  it('should throw on missing dependency', async function() {
    let manifestPathRelative =
      './integration/webmanifest-not-found/manifest.json';
    let manifestPath = path.join(__dirname, manifestPathRelative);
    let manifest = await inputFS.readFileSync(manifestPath, 'utf8');

    let message = `Failed to resolve 'icon.png' from '${escapeMarkdown(
      manifestPathRelative,
    )}'`;

    await assert.rejects(
      () =>
        bundle(
          path.join(__dirname, '/integration/webmanifest-not-found/index.html'),
        ),
      {
        name: 'BuildError',
        message,
        diagnostics: [
          {
            codeFrame: {
              code: manifest,
              codeHighlights: [
                {
                  end: {
                    column: 23,
                    line: 5,
                  },
                  start: {
                    column: 14,
                    line: 5,
                  },
                },
              ],
            },
            message,
            filePath: manifestPath,
            origin: '@parcel/core',
          },
          {
            hints: [],
            message: `Cannot load file './icon.png' in '${path.dirname(
              manifestPathRelative,
            )}'.`,
            origin: '@parcel/resolver-default',
          },
        ],
      },
    );
  });
});
