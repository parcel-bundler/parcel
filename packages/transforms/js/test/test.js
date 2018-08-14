const assert = require('assert');
const Path = require('path');
const jsTransformer = require('../src/js-transformer');

describe('Javascript', function() {
  it('should process a javascript module', async function() {
    let dummyModule = {
      code: `
        import React from 'react';
        const someModule = require('./module.js');

        function helloworld(count) {
          return 1 + count;
        }

        console.log(helloworld(5));
      `,
      name: Path.join(__dirname, 'index.js'),
      relativeName: './index.js'
    };

    assert(await jsTransformer.canReuseAST({
      type: 'babel',
      version: '7.3.5'
    }) === false);

    assert(await jsTransformer.canReuseAST({
      type: 'bobil',
      version: '6.3.5'
    }) === false);

    assert(await jsTransformer.canReuseAST({
      type: 'babel',
      version: '6.3.5'
    }));

    dummyModule.ast = await jsTransformer.parse(dummyModule, {}, {});

    dummyModule = (await jsTransformer.transform(dummyModule, {}))[0];

    let result = await jsTransformer.generate(dummyModule, {});
    
    assert(dummyModule.deps.length === 2);
    assert(!result.code.includes('number'));
    assert(result.map === null);
  });
});
