const localRequire = require('./localRequire');
const install = require('./installPackage');

module.exports = async function loadPlugins(
  plugins,
  relative,
  installPlugins = false
) {
  if (Array.isArray(plugins)) {
    if (installPlugins) {
      await install(plugins, relative);
    }
    return plugins.map(p => loadPlugin(p, relative)).filter(Boolean);
  } else if (typeof plugins === 'object') {
    if (installPlugins) {
      await install(Object.keys(plugins), relative);
    }
    return Object.keys(plugins)
      .map(p =>
        loadPlugin(p, relative, {
          pluginOptions: plugins[p]
        })
      )
      .filter(Boolean);
  } else {
    return [];
  }
};

function loadPlugin(plugin, relative, options = {}) {
  if (typeof plugin === 'string') {
    if (typeof options !== 'object') {
      options = {};
    }

    plugin = localRequire(plugin, relative);
    plugin = plugin.default || plugin;

    if (Object.keys(options.pluginOptions).length > 0) {
      plugin = plugin(options.pluginOptions);
    }

    plugin = plugin.default || plugin;
  }

  return plugin;
}
