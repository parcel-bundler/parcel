const assert = require('assert');
const path = require('path');
const fs = require('@parcel/fs');
const {bundle, assertBundleTree} = require('@parcel/test-utils');

describe('markdown', function() {
  it('should support bundling Markdown', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown/index.md')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.md'],
      childBundles: [
        {
          type: 'png',
          assets: ['100x100.png'],
          childBundles: []
        },
        {
          type: 'js',
          assets: ['index.md'],
          childBundles: []
        }
      ]
    });

    let fixture = (await fs.readFile(
      path.join(__dirname, '/integration/markdown/index.fixture.html')
    ))
      .toString()
      .trim();
    let html = (await fs.readFile(path.join(__dirname, '/dist/index.html')))
      .toString()
      .trim();
    let js = (await fs.readFile(path.join(__dirname, '/dist/index.js')))
      .toString()
      .trim();

    assert.equal(html, fixture);
    assert(js.includes(JSON.stringify(fixture)));
  });

  it('should support front matter', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown/frontmatter.md')
    );

    await assertBundleTree(b, {
      name: 'frontmatter.html',
      assets: ['frontmatter.md'],
      childBundles: [
        {
          type: 'js',
          assets: ['frontmatter.md'],
          childBundles: []
        }
      ]
    });

    let fixture = (await fs.readFile(
      path.join(__dirname, '/integration/markdown/frontmatter.fixture.html')
    ))
      .toString()
      .trim();
    let html = (await fs.readFile(
      path.join(__dirname, '/dist/frontmatter.html')
    ))
      .toString()
      .trim();
    let js = (await fs.readFile(path.join(__dirname, '/dist/frontmatter.js')))
      .toString()
      .trim();

    assert.equal(html, fixture);
    assert(js.includes(JSON.stringify({key1: 'val1'})));
  });

  it('should support marked config', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown-config/index.md')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.md'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.md'],
          childBundles: []
        }
      ]
    });

    let fixture = (await fs.readFile(
      path.join(__dirname, '/integration/markdown-config/index.fixture.html')
    ))
      .toString()
      .trim();
    let html = (await fs.readFile(path.join(__dirname, '/dist/index.html')))
      .toString()
      .trim();

    assert.equal(html, fixture);
  });

  it('should support marked config from frontmatter', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown-config/local-config.md')
    );

    await assertBundleTree(b, {
      name: 'local-config.html',
      assets: ['local-config.md'],
      childBundles: [
        {
          type: 'js',
          assets: ['local-config.md'],
          childBundles: []
        }
      ]
    });

    let fixture = (await fs.readFile(
      path.join(
        __dirname,
        '/integration/markdown-config/local-config.fixture.html'
      )
    ))
      .toString()
      .trim();
    let html = (await fs.readFile(
      path.join(__dirname, '/dist/local-config.html')
    ))
      .toString()
      .trim();

    assert.equal(html, fixture);
  });

  it('should support mustache templating when the template exists', async function() {
    let b = await bundle(
      path.join(__dirname, '/integration/markdown-templating/index.md')
    );

    await assertBundleTree(b, {
      name: 'index.html',
      assets: ['index.md'],
      childBundles: [
        {
          type: 'js',
          assets: ['index.md'],
          childBundles: []
        }
      ]
    });

    let fixture = (await fs.readFile(
      path.join(
        __dirname,
        '/integration/markdown-templating/index.fixture.html'
      )
    ))
      .toString()
      .trim();
    let html = (await fs.readFile(path.join(__dirname, '/dist/index.html')))
      .toString()
      .trim();

    assert.equal(html, fixture);
  });
});
