// @flow

import * as babel from '@babel/core';
import assert from 'assert';
import preset from '@parcel/babel-preset-env';

const input = `
export default class Foo {
  constructor(x) {
    this.x = x;
  }

  load() {
    import('./bar');
  }

  square() {
    return this.x ** 2;
  }
}
`;

const plugin = require.resolve('../src/index.js');

describe('@parcel/plugin-transform-runtime', () => {
  it('compiles against targets passed through caller when the caller is parcel 2.x', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      plugins: [plugin],
      caller: {
        name: 'parcel',
        version: '2.0.0',
        targets: JSON.stringify({
          esmodules: true,
        }),
      },
    });

    assert(transformed.includes('class Foo'));
    assert(transformed.includes('this.x ** 2'));
    assert(transformed.includes('export default'));
  });

  it('does not compile against targets passed through caller when the caller is not parcel', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      plugins: [plugin],
      caller: {
        name: 'foo',
        version: '2.0.0',
        targets: JSON.stringify({
          esmodules: true,
        }),
      },
    });

    assert(!transformed.includes('class Foo'));
    assert(!transformed.includes('this.x ** 2'));
    assert(!transformed.includes('export default'));
  });

  it('does not compile against targets passed through caller when the caller is not present', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      plugins: [plugin],
    });

    assert(!transformed.includes('class Foo'));
    assert(!transformed.includes('this.x ** 2'));
    assert(!transformed.includes('export default'));
  });
});
