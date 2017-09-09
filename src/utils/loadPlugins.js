const localRequire = require('./localRequire');

module.exports = function loadPlugins(plugins, relative) {
  if (Array.isArray(plugins)) {
    return plugins.map(p => loadPlugin(p, relative)).filter(Boolean);
  } else if (typeof plugins === 'object') {
    return Object.keys(plugins).map(p => loadPlugin(p, relative, plugins[p])).filter(Boolean);
  } else {
    return [];
  }
}

function loadPlugin(plugin, relative, options) {
  if (typeof plugin === 'string') {
    plugin = localRequire(plugin, relative);
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
