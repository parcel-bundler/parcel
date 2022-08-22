import assert from 'assert';
import {bundle, outputFS} from '@parcel/test-utils';
import path from 'path';

describe('svg-react-typescript', () => {
  let file, types, b;
  before(async () => {
    b = await bundle(
      path.join(__dirname, '/integration/svg-react-typescript/react.ts'),
      {
        defaultConfig: path.join(
          __dirname,
          'integration/custom-configs/.parcelrc-svg-react',
        ),
        defaultTargetOptions: {
          typescript: true,
        },
      },
    );
    file = await outputFS.readFile(b.getBundles()[0].filePath, 'utf-8');
    types = await outputFS.readFile(b.getBundles()[1].filePath, 'utf-8');
  });

  it('should support transforming SVGs to typescript react components', function () {
    assert(!file.includes('inkscape'));
    assert(file.includes('react.createElement("svg"'));
  });

  it('should support generating typescript types for SVG react components', function () {
    assert(types.includes('const Icon: SVGRComponent'));
  });
});
