// @flow

import * as babel from '@babel/core';
import assert from 'assert';
import preset from '@atlaspack/babel-preset-env';

const input = `
export function Foo(x) {
  let a = {b: 6, ...x};
  return a;
}
`;

const plugin = require.resolve('../src/index.js');

describe('@atlaspack/plugin-transform-runtime', () => {
  it('compiles against targets passed through caller with env = esmodule', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      plugins: [plugin],
      caller: {
        name: 'atlaspack',
        version: '2.0.0',
        targets: JSON.stringify({browsers: ['last 1 Chrome version']}),
        env: 'esmodule',
      },
    });

    assert(transformed.includes('function Foo'));
    assert(transformed.includes('...x'));
  });

  it('compiles against targets passed through caller with no env', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      plugins: [plugin],
      caller: {
        name: 'atlaspack',
        version: '2.0.0',
        targets: JSON.stringify({browsers: ['last 1 Chrome version']}),
      },
    });

    assert(transformed.includes('function Foo'));
    assert(transformed.includes('...x'));
  });
});
