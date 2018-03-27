const assert = require('assert');
const fs = require('fs');
const {bundle, assertBundleTree} = require('./utils');

async function runPugTest(name) {
  let b = await bundle(__dirname + `/integration/pug/${name}.pug`);

  assertBundleTree(b, {
    name: `${name}.html`,
    assets: [`${name}.pug`]
  });

  let html = fs.readFileSync(__dirname + `/dist/${name}.html`, 'utf8').trim();
  let expected = fs
    .readFileSync(__dirname + `/integration/pug/${name}.expected`, 'utf8')
    .trim();
  assert.equal(html, expected);
}

describe('pug', function() {
  it('should support pug', async function() {
    await runPugTest('basic');
  });
  it('should support local variables', async function() {
    await runPugTest('locals');
  });
  it('should support jstransformer-coffee-script', async function() {
    await runPugTest('coffee');
  });
  it('should support jstransformer-markdown-it', async function() {
    await runPugTest('markdown');
  });
  it('should support custom filters', async function() {
    await runPugTest('custom-filters');
  });
});
