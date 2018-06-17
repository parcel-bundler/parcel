const {bundle, assertBundleTree} = require('./utils');

describe('WebExtension', () => {
  it('should produce a basic WebExtension bundle', async () => {
    const b = await bundle(
      __dirname + '/integration/web-extension/manifest.json'
    );

    await assertBundleTree(b, {
      type: 'json',
      assets: ['manifest.json'],
      childBundles: [
        {name: 'background_script.js'},
        {name: 'content_script.css'},
        {name: 'content_script.js'},
        {name: 'favicon.ico'},
        {name: 'inject.js'},
        {name: 'popup.html'}
      ]
    });
  });
});
