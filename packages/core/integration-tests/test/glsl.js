import assert from 'assert';
import path from 'path';
import fs from 'fs';
import {bundle, run, normaliseNewlines} from '@parcel/test-utils';

describe('glsl', function() {
  it('should support requiring GLSL files via glslify', async function() {
    let b = await bundle(path.join(__dirname, '/integration/glsl/index.js'));

    let shader = fs.readFileSync(
      path.join(__dirname, '/integration/glsl/compiled.glsl'),
      'utf8',
    );

    let output = await run(b);
    assert.equal(typeof output, 'function');
    assert.ok(
      output().reduce((acc, requiredShader) => {
        return (
          acc && normaliseNewlines(shader) === normaliseNewlines(requiredShader)
        );
      }, true),
    );
  });
});
