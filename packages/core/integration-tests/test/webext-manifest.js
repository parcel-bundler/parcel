const path = require('path');
const {bundle, assertBundles} = require('@parcel/test-utils');
const fs = require('@parcel/fs');

describe('webext-manifest', function() {
  it('should support web extension manifest.json', async function() {
    const b = await bundle(
      path.join(__dirname, '/integration/web-extension/manifest.json'),
      {outputFS: new fs.NodeFS()} // FIXME
    );

    await assertBundles(b, [
      {
        type: 'json',
        name: 'manifest.json',
        assets: ['manifest.json']
      },

      // icons
      {
        type: 'png',
        assets: ['icon48.png']
      },

      // browser_action
      {
        type: 'html',
        name: 'browser-popup.html',
        assets: ['browser-popup.html']
      },
      {
        type: 'js',
        assets: ['browser-popup.jsx']
      },
      {
        type: 'png',
        assets: ['icon16.png']
      },
      {
        type: 'png',
        assets: ['light.png']
      },
      {
        type: 'png',
        assets: ['dark.png']
      },

      // page_action
      {
        type: 'html',
        name: 'page-popup.html',
        assets: ['page-popup.html']
      },
      {
        type: 'js',
        assets: ['page-popup.js']
      },
      {
        type: 'png',
        assets: ['icon32.png']
      },

      // background
      {
        type: 'js',
        assets: ['background.ts']
      },
      {
        type: 'html',
        name: 'background.html',
        assets: ['background.html']
      },

      // content_scripts
      {
        type: 'js',
        assets: ['content.js']
      },
      {
        type: 'css',
        assets: ['content.css']
      },

      // html pages
      {
        type: 'html',
        name: 'devtools.html',
        assets: ['devtools.html']
      },
      {
        type: 'html',
        name: 'options.html',
        assets: ['options.html']
      },
      {
        type: 'html',
        name: 'options-ui.html',
        assets: ['options-ui.html']
      },

      // chrome pages
      {
        type: 'html',
        name: 'bookmarks.html',
        assets: ['bookmarks.html']
      },
      {
        type: 'html',
        name: 'newtab.html',
        assets: ['newtab.html']
      },
      {
        type: 'html',
        name: 'history.html',
        assets: ['history.html']
      },

      // sidebar_action
      {
        type: 'html',
        name: 'sidebar.html',
        assets: ['sidebar.html']
      },
      {
        type: 'js',
        assets: ['sidebar.js']
      },
      {
        type: 'png',
        assets: ['star.png']
      },

      // theme
      {
        type: 'png',
        assets: ['theme.png']
      },

      // web_accessible_resources wildcards
      {
        type: 'js',
        assets: ['1.js']
      },
      {
        type: 'css',
        assets: ['1.css']
      },
      {
        type: 'css',
        assets: ['2.css']
      },
      {
        type: 'js',
        assets: ['1.json']
      },
      {
        type: 'js',
        assets: ['2.ts']
      },
      {
        type: 'js',
        assets: ['index.js']
      }

      // nacl_modules ?
      // storage ?
      // dictionaries ?
      // _locales ?
    ]);
  });
});
