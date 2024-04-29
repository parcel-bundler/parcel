import {parse, print} from '@swc/core';
import {RequireInliningVisitor} from '../src/RequireInliningVisitor';
import assert from 'assert';
import logger from '@parcel/logger';

async function testRequireInliningVisitor(src, sideEffects) {
  const ast = await parse(src, {});
  const assetPublicIdsWithSideEffects = new Set(sideEffects);

  const visitor = new RequireInliningVisitor({
    bundle: {
      name: 'test-bundle',
    },
    assetPublicIdsWithSideEffects,
    logger,
  });
  visitor.visitProgram(ast);
  return (await print(ast)).code;
}

function getModule(body) {
  return `
    n.register('def456', function(require, module, exports) {
        ${body}
    });
    `;
}

function normaliseCode(code) {
  return code
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .trim();
}

function assertEqualCode(left, right) {
  assert.equal(normaliseCode(left), normaliseCode(right));
}

describe('InliningVisitor', () => {
  it('performs basic inlining', async () => {
    const src = getModule(`
        var $abc123 = require('abc123');
        console.log($abc123);`);
    const result = await testRequireInliningVisitor(src, []);
    assertEqualCode(
      result,
      getModule(`var $abc123;
      console.log((0, require('abc123')));`),
    );
  });

  it('performs module default inlining', async () => {
    const src = getModule(
      `var $abc123 = require('abc123');
        var $abc123Default =  parcelHelpers.interopDefault($abc123);
        console.log($abc123Default.foo());`,
    );
    const expected = getModule(
      `var $abc123;
        var $abc123Default;
        console.log((0, parcelHelpers.interopDefault(require('abc123'))).foo());`,
    );
    const result = await testRequireInliningVisitor(src, []);
    assertEqualCode(result, expected);
  });

  it('ignores assets with sideEffects', async () => {
    const src = getModule(`var $abc123 = require('abc123');
        var $abc456 = require('abc456');
        console.log($abc123);
        console.log($abc456);`);
    const expected = getModule(`var $abc123 = require('abc123');
        var $abc456;
        console.log($abc123);
        console.log((0, require('abc456')));`);
    const result = await testRequireInliningVisitor(src, ['abc123']);
    assertEqualCode(result, expected);
  });
});
