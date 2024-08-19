// @flow

import * as babel from '@babel/core';
import assert from 'assert';

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

const preset = require.resolve('../src');

describe('@atlaspack/babel-preset-env', () => {
  it('compiles against targets passed through caller when the caller is atlaspack 2.x', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      caller: {
        name: 'atlaspack',
        version: '2.0.0',
        targets: JSON.stringify({
          browsers: ['last 1 Chrome version'],
        }),
      },
    });

    assert(transformed.includes('class Foo'));
    assert(transformed.includes('this.x ** 2'));
    assert(transformed.includes('export default'));
  });

  it('does not compile against targets passed through caller when the caller is not atlaspack', () => {
    let {code: transformed} = babel.transformSync(input, {
      configFile: false,
      presets: [preset],
      caller: {
        name: 'foo',
        version: '2.0.0',
        targets: JSON.stringify({
          browsers: ['last 1 Chrome version'],
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
    });

    assert(!transformed.includes('class Foo'));
    assert(!transformed.includes('this.x ** 2'));
    assert(!transformed.includes('export default'));
  });
});
