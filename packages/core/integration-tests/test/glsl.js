import assert from 'assert';
import path from 'path';
import fs from 'fs';
import {
  bundle,
  describe,
  it,
  run,
  normaliseNewlines,
} from '@atlaspack/test-utils';

describe.v2('glsl', function () {
  it('should support requiring GLSL files via glslify', async function () {
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

  it('should correctly resolve relative GLSL imports', async function () {
    let b = await bundle(
      path.join(__dirname, '/integration/glsl-relative-import/index.js'),
    );

    let output = await run(b);
    assert.strictEqual(
      output.trim(),
      `#define GLSLIFY 1
float b(float p) { return p*2.0; }

float c(float p) { return b(p)*3.0; }

varying float x;

void main() { gl_FragColor = vec4(c(x)); }`,
    );
  });
});
