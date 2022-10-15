import assert from 'assert';
import {bundle, outputFS} from '@parcel/test-utils';
import path from 'path';

describe('svg-react', function () {
  it('should support transforming SVGs to react components', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/svg-react/react.js'),
      {
        defaultConfig: path.join(
          __dirname,
          'integration/custom-configs/.parcelrc-svg-react',
        ),
      },
    );

    let file = await outputFS.readFile(b.getBundles()[0].filePath, 'utf-8');
    assert(!file.includes('inkscape'));
    assert(file.includes('const SvgIcon ='));
    assert(file.includes('_react.createElement("svg"'));
  });
  it('should support transforming SVGs to typescript react components', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/svg-react-typescript/react.ts'),
      {
        defaultConfig: path.join(
          __dirname,
          'integration/custom-configs/.parcelrc-svg-react',
        ),
      },
    );
    let file = await outputFS.readFile(b.getBundles()[0].filePath, 'utf-8');
    let types = await outputFS.readFile(b.getBundles()[1].filePath, 'utf-8');

    assert(!file.includes('inkscape'));
    assert(file.includes('react.createElement("svg"'));
    assert(types.includes('const Icon: SVGRComponent'));
  });
});
