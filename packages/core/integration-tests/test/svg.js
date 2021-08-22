import assert from 'assert';
import {assertBundles, bundle, distDir, outputFS} from '@parcel/test-utils';
import path from 'path';

describe('svg', function() {
  it('should support bundling SVG', async () => {
    let b = await bundle(path.join(__dirname, '/integration/svg/circle.svg'));

    assertBundles(b, [
      {
        name: 'circle.svg',
        assets: ['circle.svg'],
      },
      {
        name: 'other1.html',
        assets: ['other1.html'],
      },
      {
        type: 'svg',
        assets: ['square.svg'],
      },
      {
        name: 'other2.html',
        assets: ['other2.html'],
      },
    ]);
  });

  it('should minify SVG bundles', async function() {
    let b = await bundle(path.join(__dirname, '/integration/svg/circle.svg'), {
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    let file = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'svg').filePath,
      'utf-8',
    );
    assert(!file.includes('comment'));
  });

  it('support SVGO config files', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/svgo-config/index.html'),
      {
        defaultTargetOptions: {
          shouldOptimize: true,
        },
      },
    );

    let file = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'svg').filePath,
      'utf-8',
    );
    assert(!file.includes('inkscape'));
    assert(file.includes('comment'));
  });

  it('should detect xml-stylesheet processing instructions', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/svg-xml-stylesheet/img.svg'),
    );

    assertBundles(b, [
      {
        name: 'img.svg',
        assets: ['img.svg'],
      },
      {
        type: 'css',
        assets: ['style1.css'],
      },
      {
        type: 'css',
        assets: ['style3.css'],
      },
    ]);

    let file = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'svg').filePath,
      'utf-8',
    );

    assert(file.includes('<?xml-stylesheet'));
    assert(file.includes('<?xml-not-a-stylesheet'));
  });

  it('should handle CSS with @imports', async function() {
    const b = await bundle(
      path.join(__dirname, '/integration/svg-css-import/img.svg'),
    );

    assertBundles(b, [
      {
        type: 'css',
        assets: ['img.svg', 'test.css'],
      },
      {
        name: 'img.svg',
        assets: ['img.svg'],
      },
    ]);

    const svg = await outputFS.readFile(path.join(distDir, 'img.svg'), 'utf8');

    assert(!svg.includes('@import'));
    assert(svg.includes(':root {\n  fill: red\n}'));
  });
});
