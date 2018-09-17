const babelCore = require('@babel/core');
const fs = require('../src/utils/fs');
const {
  babel6toBabel7,
  babel7toBabel6
} = require('../src/transforms/babel/astConverter');
const path = require('path');
const BabelFlowPreset = require('@babel/preset-flow');
const babelPresetEnv = require('@babel/preset-env');
const traverse = require('@babel/traverse').default;
const assert = require('assert');

describe('babel', function() {
  let ast;
  before(async function() {
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

    ast = babelCore.parse(code, options);
  });

  it('Should be able to convert Babel 7 => Babel 6 AST', async function() {
    ast = babel7toBabel6(ast);

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

  it('Should be able to convert Babel 6 => Babel 7 AST', async function() {
    ast = babel6toBabel7(ast);

    let elementCount = {};
    traverse(ast, {
      enter(path) {
        if (!elementCount[path.node.type]) {
          elementCount[path.node.type] = 0;
        }
        elementCount[path.node.type]++;

        if (path.node.variance) {
          assert(!!path.node.variance.kind);
          assert.equal(path.node.variance.type, 'VarianceNode');
        }

        if (path.node.type === 'ForOfStatement') {
          assert(path.node.await);
        }

        if (path.node.type === 'ArrowFunctionExpression') {
          assert(path.node.expression === undefined);
        }
      }
    });

    // Check Renaming/Removal of Nodes
    assert.equal(elementCount['ExistsTypeAnnotation'], 1);
    assert.equal(elementCount['ExistentialTypeParam'], undefined);

    assert.equal(elementCount['NumberLiteralTypeAnnotation'], 1);
    assert.equal(elementCount['NumericLiteralTypeAnnotation'], undefined);

    assert.equal(elementCount['ForOfStatement'], 1);
    assert.equal(elementCount['ForAwaitStatement'], undefined);

    assert.equal(elementCount['SpreadElement'], 2);
    assert.equal(elementCount['SpreadProperty'], undefined);

    assert.equal(elementCount['RestElement'], 2);
    assert.equal(elementCount['RestProperty'], undefined);

    // Check node count
    assert.equal(elementCount['TypeParameter'], 6);

    assert.equal(elementCount['ArrowFunctionExpression'], 2);
  });
});
