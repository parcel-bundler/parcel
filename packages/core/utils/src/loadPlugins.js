const localRequire = require('./localRequire');

module.exports = async function loadPlugins(plugins, relative) {
  if (Array.isArray(plugins)) {
    return Promise.all(
      plugins.map(p => loadPlugin(p, relative)).filter(Boolean)
    );
  } else if (typeof plugins === 'object') {
    let mapPlugins = await Promise.all(
      Object.keys(plugins).map(p => loadPlugin(p, relative, plugins[p]))
    );
    return mapPlugins.filter(Boolean);
  } else {
    return [];
  }
};

async function loadPlugin(plugin, relative, options) {
  if (typeof plugin === 'string') {
    plugin = await localRequire(plugin, relative);
    plugin = plugin.default || plugin;

    if (typeof options !== 'object') {
      options = {};
    }

    if (Object.keys(options).length > 0) {
      plugin = plugin(options);
    }

    plugin = plugin.default || plugin;
  }

  return plugin;
}
