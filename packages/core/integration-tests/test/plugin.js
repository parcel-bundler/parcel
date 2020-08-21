// @flow
import type {Dependency} from '@parcel/types';

import assert from 'assert';
import path from 'path';
import nullthrows from 'nullthrows';
import {bundle, outputFS as fs, distDir, run} from '@parcel/test-utils';

describe('plugin', function() {
  it("continue transformer pipeline on type change that doesn't change the pipeline", async function() {
    await bundle(
      path.join(__dirname, '/integration/pipeline-type-change/index.ini'),
    );

    let output = await fs.readFile(path.join(distDir, 'index.txt'), 'utf8');
    assert.equal(
      output,
      `INPUT
parcel-transformer-a
parcel-transformer-b`,
    );
  });

  it('should allow optimizer plugins to change the output file type', async function() {
    await bundle(
      path.join(__dirname, '/integration/optimizer-changing-type/index.js'),
    );

    assert.deepEqual(fs.readdirSync(distDir), ['index.test']);
  });

  it('should allow resolver plugins to disable deferring', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/resolver-canDefer/index.js'),
      {mode: 'production'},
    );

    let calls = [];
    let output = await run(b, {
      sideEffect(v) {
        calls.push(v);
      },
    });

    assert.strictEqual(output, 'A');
    assert.deepStrictEqual(calls, ['a', 'b']);

    let depB: ?Dependency;
    let depC: ?Dependency;
    nullthrows(b.getBundles()[0]).traverse(node => {
      if (node.type === 'dependency') {
        if (node.value.moduleSpecifier === './c.js') {
          depC = node.value;
        } else if (node.value.moduleSpecifier === './b.js') {
          depB = node.value;
        }
      }
    });

    assert(!b.isDependencyDeferred(nullthrows(depB)));
    assert(b.isDependencyDeferred(nullthrows(depC)));
  });
});
