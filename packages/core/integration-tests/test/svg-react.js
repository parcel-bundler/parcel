import assert from 'assert';
import {bundle, describe, it, outputFS} from '@atlaspack/test-utils';
import path from 'path';

describe.v2('svg-react', function () {
  it('should support transforming SVGs to react components', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/svg-react/react.js'),
      {
        defaultConfig: path.join(
          __dirname,
          'integration/custom-configs/.atlaspackrc-svg-react',
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
          'integration/custom-configs/.atlaspackrc-svg-react',
        ),
      },
    );
    let file = await outputFS.readFile(b.getBundles()[0].filePath, 'utf-8');
    let types = await outputFS.readFile(b.getBundles()[1].filePath, 'utf-8');

    assert(!file.includes('inkscape'));
    assert(file.includes('react.createElement("svg"'));
    assert(types.includes('const Icon: SVGRComponent'));
  });

  it('should find and use a .svgrrc and .svgorc config file', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/svg-react-config/react.js'),
      {
        defaultConfig: path.join(
          __dirname,
          'integration/custom-configs/.atlaspackrc-svg-react',
        ),
      },
    );

    let file = await outputFS.readFile(b.getBundles()[0].filePath, 'utf-8');
    assert(!file.includes('inkscape'));
    assert(!/\d\.\d/.test(file));
    assert(file.includes('const SvgIcon ='));
    assert(file.includes('(0, _preact.h)("svg"'));
    assert(file.includes('width: "1em"'));
  });
});
