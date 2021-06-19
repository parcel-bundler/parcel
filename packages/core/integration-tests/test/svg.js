import assert from 'assert';
import {bundle, outputFS} from '@parcel/test-utils';
import path from 'path';

describe('svg', function() {
  it('should minify SVG bundles', async function() {
    let b = await bundle(path.join(__dirname, '/integration/svg/index.html'), {
      defaultTargetOptions: {
        shouldOptimize: true,
      },
    });

    let file = await outputFS.readFile(
      b.getBundles().find(b => b.type === 'svg').filePath,
      'utf-8',
    );
    assert(!file.includes('inkscape'));
  });

  it('should support transforming SVGs to react components', async function() {
    let b = await bundle(path.join(__dirname, '/integration/svg/react.js'), {
      defaultConfig: path.join(
        __dirname,
        'integration/custom-configs/.parcelrc-svg',
      ),
    });

    let file = await outputFS.readFile(b.getBundles()[0].filePath, 'utf-8');
    assert(!file.includes('inkscape'));
    assert(file.includes('function SvgIcon'));
    assert(file.includes('_react.createElement("svg"'));
  });
});
