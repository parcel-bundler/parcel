const Asset = require('./Asset');

function loadPlugin(plugin, parser, options = parser.options) {
  if (typeof plugin === 'function') {
    plugin = plugin(options);
  }

  // plugin = await plugin

  if (plugin.Asset) {
    composeAssets(plugin.Asset, parser);
  }
}

function composeAssets(assets, parser) {
  Object.keys(assets).forEach(extension => {
    let {type, ...asset} = assets[extension];
    let components = Object.keys(asset).map(name => {
      let fn = Asset.prototype[name];

      if (!fn) {
        throw new Error(`Method "${name}" does not exist`);
      }
      if (!fn.extensible) {
        throw new Error(`Method "${name}" is not extensible`);
      }

      return {
        name,
        method: asset[name]
      };
    });

    parser.composeAssets('.' + extension, components, type);
  });
}

module.exports = loadPlugin;
