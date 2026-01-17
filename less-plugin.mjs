// import * as createLess from 'less/lib/less/index.js';
const createLess = require('less/lib/less/index.js');

const less = createLess.default({}, {});
less.PluginLoader = function() {}

export function transform(asset) {
  let content = asset.text();
  let result;
  less.render(content, (err, output) => {
    result = output.css;
  });

  asset.setText(result);
  asset.type = 'css';
}
