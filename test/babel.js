const babelCore = require('@babel/core');
const fs = require('../src/utils/fs');
const BabelASTConvertor = require('../src/transforms/babelASTConvertor');
const path = require('path');
const BabelFlowPreset = require('@babel/preset-flow');
const babelPresetEnv = require('@babel/preset-env');
const traverse = require('@babel/traverse').default;
const assert = require('assert');

describe.only('Babel', function() {
  it.only('Should be able to convert Babel 7 to Babel 6 AST', async function() {
    const options = {
      parserOpts: {
        allowReturnOutsideFunction: true,
        allowHashBang: true,
        ecmaVersion: Infinity,
        strictMode: false,
        sourceType: 'module',
        locations: true,
        tokens: true
      },
      presets: [BabelFlowPreset, babelPresetEnv]
    };

    let code = await fs.readFile(
      path.join(__dirname, './integration/babel-ast-conversion/index.js'),
      'utf8'
    );
    let ast = babelCore.parse(code, options);

    ast = BabelASTConvertor(ast, 7);

    let elementCount = {};
    traverse(ast, {
      enter(path) {
        if (!elementCount[path.node.type]) {
          elementCount[path.node.type] = 0;
        }
        elementCount[path.node.type]++;

        if (path.node.variance) {
          assert(!path.node.variance.kind);
        }

        if (path.node.type === 'ForAwaitStatement') {
          assert(!path.node.await);
        }

        if (path.node.type === 'ArrowFunctionExpression') {
          assert(path.node.expression !== undefined);
        }
      }
    });

    // Check Renaming/Removal of Nodes
    assert.equal(elementCount['ExistsTypeAnnotation'], undefined);
    assert.equal(elementCount['ExistentialTypeParam'], 1);

    assert.equal(elementCount['NumberLiteralTypeAnnotation'], undefined);
    assert.equal(elementCount['NumericLiteralTypeAnnotation'], 1);

    assert.equal(elementCount['ForOfStatement'], undefined);
    assert.equal(elementCount['ForAwaitStatement'], 1);

    assert.equal(elementCount['SpreadElement'], undefined);
    assert.equal(elementCount['SpreadProperty'], 2);

    assert.equal(elementCount['RestElement'], undefined);
    assert.equal(elementCount['RestProperty'], 2);

    // Check node count
    assert.equal(elementCount['TypeParameter'], 6);

    assert.equal(elementCount['ArrowFunctionExpression'], 2);
  });
});
